/**
 * market 域路由（TDD-S-02 §1 端点表六行；T2-05/06/07）。
 * list/detail 匿名（浏览不登录 D-1）；download/installs/publish/mine=requireActiveUser。
 * 限流（kernel rateLimit 路由级注册——publish 6/min、download 30/min 设计值；内核按 IP 分桶，
 * 单容器部署 IP≈用户，与 auth 10/min/IP 同口径）。
 * download 能力协商：storage.signedUrl 可用（s3 位，T2-13）→ 302；StoragePresignUnsupported（disk）
 * → getStream 流式 + Content-Disposition: attachment。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { Readable } from "node:stream";
import { requireActiveUser } from "../../kernel/auth.middleware.js";
import { ApiError } from "../../kernel/errors.js";
import { rateLimit } from "../../kernel/rate-limit.js";
import type { AppEnv } from "../../kernel/kernel.js";
import { getStorage } from "../../infra/storage/storage.factory.js";
import { StoragePresignUnsupported } from "../../infra/storage/storage.types.js";
import { prisma } from "../../utils/prisma.js";
import { detail, list, mine } from "./market-query.service.js";
import { idParamSchema, installReqSchema, listQuerySchema, publishMetaSchema } from "./market.schemas.js";
import type { PublishMeta } from "./market.schemas.js";
import { publish } from "./publish-pipeline.js";
import { recordDownload, recordInstall } from "./metering.service.js";

/** 查询参/路径校验失败 → 400 VALIDATION-FAILED */
function parseOr400<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION-FAILED");
  }
  return parsed.data;
}

/** GET /market/packages —— 匿名列表（过滤/搜索/排序/分页） */
const listHandler = async (c: Context<AppEnv>) => {
  const query = parseOr400(listQuerySchema, c.req.query());
  return c.json(await list(query), 200);
};

/** GET /market/packages/:id —— 匿名详情（非 APPROVED → 404 不泄露存在性） */
const detailHandler = async (c: Context<AppEnv>) => {
  const { id } = parseOr400(idParamSchema, { id: c.req.param("id") });
  return c.json(await detail(id), 200);
};

/** GET /market/packages/:id/download —— 计量 + 能力协商发放（302 或流式） */
const downloadHandler = async (c: Context<AppEnv>) => {
  const user = c.get("currentUser");
  const { id } = parseOr400(idParamSchema, { id: c.req.param("id") });

  const pkg = await prisma.package.findUnique({ where: { id }, include: { latestVersion: true } });
  if (!pkg || !pkg.latestVersion) {
    throw new ApiError("MARKET-PACKAGE-NOT-FOUND");
  }
  if (pkg.status !== "APPROVED") {
    // 审核通过前一律 404（02 §12.4 未审核包行；含 PENDING/REJECTED/OFFLINE）
    throw new ApiError("MARKET-PACKAGE-NOT-APPROVED");
  }

  // 发放前事务：DownloadStat(DOWNLOAD) + downloadCount 原子 +1（失败即不放发）
  await recordDownload(pkg.id, user.id);

  const storage = getStorage();
  const { storageKey, semver } = pkg.latestVersion;
  try {
    const url = await storage.signedUrl(storageKey, { expiresInSec: 300 });
    return c.redirect(url, 302); // S3 能力位（s3 驱动落地后生效）
  } catch (err) {
    if (!(err instanceof StoragePresignUnsupported)) {
      throw err; // 能力声明非静默降级：仅 disk 的不支持异常走流式，其余照抛
    }
  }

  const stream = await storage.getStream(storageKey);
  c.header("Content-Type", "application/zip");
  c.header("Content-Disposition", `attachment; filename="${semver}.zip"`);
  return c.body(Readable.toWeb(stream) as unknown as ReadableStream, 200);
};

/** POST /market/packages/:id/installs —— 安装计量（幂等窗 userId+packageId+day） */
const installHandler = async (c: Context<AppEnv>) => {
  const user = c.get("currentUser");
  const { id } = parseOr400(idParamSchema, { id: c.req.param("id") });
  // body 无业务字段（{}）；存在时仅作形状提示，不强制（缺 body 的客户端兼容）
  const raw: unknown = await c.req.json().catch(() => ({}));
  if (raw !== null && typeof raw === "object" && !installReqSchema.safeParse(raw).success) {
    throw new ApiError("VALIDATION-FAILED");
  }

  const pkg = await prisma.package.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!pkg || pkg.status !== "APPROVED") {
    throw new ApiError("NOT-FOUND"); // 未审核包计量无意义——按不可见处理（表内错误码仅 NOT-FOUND）
  }
  await recordInstall(pkg.id, user.id);
  return c.json({ ok: true }, 200);
};

/** multipart meta 解析：meta 字段（JSON 字符串）优先，兜底散字段 kind/name/summary */
function parsePublishMeta(body: Record<string, string | File>): PublishMeta {
  let candidate: unknown;
  const metaField = body["meta"];
  if (typeof metaField === "string" && metaField.length > 0) {
    try {
      candidate = JSON.parse(metaField);
    } catch {
      throw new ApiError("VALIDATION-FAILED");
    }
  } else {
    candidate = {
      kind: body["kind"],
      name: body["name"],
      ...(typeof body["summary"] === "string" ? { summary: body["summary"] } : {}),
    };
  }
  const parsed = publishMetaSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ApiError("VALIDATION-FAILED");
  }
  return parsed.data;
}

/** POST /market/packages —— 发布处理序①~⑥（202 PublishAccepted） */
const publishHandler = async (c: Context<AppEnv>) => {
  const user = c.get("currentUser");
  let body: Record<string, string | File>;
  try {
    body = (await c.req.parseBody()) as Record<string, string | File>;
  } catch {
    throw new ApiError("VALIDATION-FAILED");
  }
  const file = body["file"];
  if (!(file instanceof File)) {
    throw new ApiError("MARKET-FILE-INVALID", "multipart 'file' field (zip) is required");
  }
  const meta = parsePublishMeta(body);
  const data = Buffer.from(await file.arrayBuffer());
  const accepted = await publish(user.id, { data, filename: file.name, contentType: file.type }, meta);
  return c.json(accepted, 202);
};

/** GET /market/mine —— 我的发布（全状态＋驳回理由） */
const mineHandler = async (c: Context<AppEnv>) => {
  const user = c.get("currentUser");
  return c.json(await mine(user.id), 200);
};

const marketRoutes = new Hono<AppEnv>();
marketRoutes.get("/packages", listHandler);
marketRoutes.get("/packages/:id", detailHandler);
marketRoutes.get(
  "/packages/:id/download",
  requireActiveUser,
  rateLimit({ name: "market:download", limit: 30, windowMs: 60_000 }),
  downloadHandler,
);
marketRoutes.post("/packages/:id/installs", requireActiveUser, installHandler);
marketRoutes.post(
  "/packages",
  requireActiveUser,
  rateLimit({ name: "market:publish", limit: 6, windowMs: 60_000 }),
  publishHandler,
);
marketRoutes.get("/mine", requireActiveUser, mineHandler);

export { marketRoutes };

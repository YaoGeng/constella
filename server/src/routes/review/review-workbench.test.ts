/**
 * T2-09 验收：审核队列＋工作台＋下载预检（TDD-S-03 §6.2）＋E2E B-11 链路（S-03 §6.4＝S-02 §6.4 复用）。
 * 装配走真实链：buildApp() → routes/index.ts /api/admin 子树统一挂 authMiddleware → requireAdmin
 * （S-03 §2「不 import S-04」的装配证据）。
 * 覆盖：
 * - 队列：status 过滤（四态）、分页、items 元素形=ReviewQueueItem（kind 小写/author 脱敏/perms/sizeBytes/semver）；
 * - RBAC：无 token → 401、USER token → 403 FORBIDDEN（§6.2）；
 * - 工作台：AdminPackageDetail（manifest 原文/versions/脚本清单键集随 manifest.scripts）＋404；
 * - 下载预检：流式 zip＋Content-Disposition（PENDING 亦可预检）＋对象缺失 404；
 * - E2E（B-11，对隧道 PG 真跑）：A 注册→发布→202 PENDING→admin 审核通过→
 *   B download 200 且 downloadCount=1→installs {ok}。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { resetRateLimitForTests } from "../../kernel/rate-limit.js";
import { getStorage } from "../../infra/storage/storage.factory.js";
import { prisma } from "../../utils/prisma.js";
import { samplePackageZip } from "../market/testing/zip-builder.js";

const app = buildApp();
// 清扫前缀互斥：不得为其他套件前缀的扩展（review.test.ts 以 startsWith 圈范围——
// "vitest-review-wb-" 会并入其清扫集引发跨文件 FK 竞态）
const EMAIL_PREFIX = "vitest-wb-";
const JSON_HEADERS = { "content-type": "application/json" };

function uniqueEmail(): string {
  return `${EMAIL_PREFIX}${randomUUID()}@test.local`;
}

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

async function createUser(role?: "ADMIN"): Promise<TestUser> {
  const email = uniqueEmail();
  await app.request("/api/auth/register", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email, password: "12345678" }) });
  if (role === "ADMIN") {
    await prisma.user.update({ where: { email }, data: { role: "ADMIN" } });
  }
  const login = (await (await app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email, password: "12345678" }) })).json()) as { accessToken: string; user: { id: string } };
  return { id: login.user.id, email, accessToken: login.accessToken };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let admin: TestUser;
let plainUser: TestUser;
let owner: TestUser;

type SeedStatus = "PENDING" | "APPROVED" | "REJECTED" | "OFFLINE";

interface SeededPkg {
  id: string;
  storageKey: string;
  semver: string;
}

/** 直建包＋版本（含 scripts 的 manifest——工作台脚本键集断言源）；可选落盘对象 */
async function seedPackage(status: SeedStatus, opts: { withObject?: boolean } = {}): Promise<SeededPkg> {
  const pkg = await prisma.package.create({
    data: {
      kind: "NODE",
      name: `工作台-${status}-${randomUUID().slice(0, 6)}`,
      summary: "工作台种子",
      ownerUserId: owner.id,
      status,
      perms: ["CDP", "网络"],
    },
  });
  const semver = "1.0.0";
  const storageKey = `packages/${pkg.id}/${semver}.zip`;
  const zipBytes = samplePackageZip({
    name: pkg.name,
    nodes: [{ type: "custom.wb", category: "网络" }], // custom → manifest.scripts 含 custom.wb 键
  });
  const version = await prisma.packageVersion.create({
    data: {
      packageId: pkg.id,
      semver,
      storageKey,
      checksum: `sha256:${randomUUID()}`,
      sizeBytes: zipBytes.length,
      manifest: {
        kind: "node",
        name: pkg.name,
        version: semver,
        scripts: { "custom.wb": { file: "scripts/0.py", lang: "python", entry: "run" } },
      },
    },
  });
  await prisma.package.update({ where: { id: pkg.id }, data: { latestVersionId: version.id } });
  if (opts.withObject) {
    await getStorage().put(storageKey, zipBytes, { contentType: "application/zip", checksum: version.checksum });
  }
  return { id: pkg.id, storageKey, semver };
}

const sizeBytesOf = (seeded: { id: string }) =>
  prisma.packageVersion.findFirstOrThrow({ where: { packageId: seeded.id } }).then((v) => v.sizeBytes);

const createdPackageIds: string[] = [];
const seededKeys: string[] = [];

beforeAll(async () => {
  admin = await createUser("ADMIN");
  plainUser = await createUser();
  owner = await createUser();
});

beforeEach(() => {
  resetRateLimitForTests();
});

afterAll(async () => {
  // 两轮清扫（隧道高延迟下防 in-flight 残留漏删→FK 拦截）
  for (let round = 0; round < 2; round++) {
    const users = await prisma.user.findMany({ where: { email: { startsWith: EMAIL_PREFIX } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) break;
    const pkgs = await prisma.package.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
    const pkgIds = pkgs.map((p) => p.id);
    const versions = pkgIds.length > 0 ? await prisma.packageVersion.findMany({ where: { packageId: { in: pkgIds } } }) : [];
    for (const v of versions) {
      await getStorage().delete(v.storageKey).catch(() => undefined);
    }
    for (const key of seededKeys) {
      await getStorage().delete(key).catch(() => undefined);
    }
    if (pkgIds.length > 0) {
      await prisma.package.updateMany({ where: { id: { in: pkgIds } }, data: { latestVersionId: null } });
      await prisma.$transaction([
        prisma.packageVersion.deleteMany({ where: { packageId: { in: pkgIds } } }),
        prisma.reviewRecord.deleteMany({ where: { packageId: { in: pkgIds } } }),
        prisma.downloadStat.deleteMany({ where: { packageId: { in: pkgIds } } }),
        prisma.package.deleteMany({ where: { id: { in: pkgIds } } }),
      ]);
    }
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

describe("review queue（GET /api/admin/reviews）", () => {
  it("§6.2 无 token → 401；USER token → 403 FORBIDDEN", async () => {
    const noToken = await app.request("/api/admin/reviews");
    expect(noToken.status).toBe(401);
    expect(((await noToken.json()) as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");

    const userToken = await app.request("/api/admin/reviews", { headers: auth(plainUser.accessToken) });
    expect(userToken.status).toBe(403);
    expect(((await userToken.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("status 过滤：items 元素形=ReviewQueueItem（kind 小写/author 脱敏/perms/sizeBytes/semver/createdAt）", async () => {
    const pending = await seedPackage("PENDING");
    const approved = await seedPackage("APPROVED");
    createdPackageIds.push(pending.id, approved.id);

    const res = await app.request("/api/admin/reviews?status=pending", { headers: auth(admin.accessToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        packageId: string; kind: string; name: string; summary?: string;
        author: { id: string; name: string }; perms: string[]; sizeBytes: number; semver: string; createdAt: string;
      }>;
      total: number;
    };
    const item = body.items.find((i) => i.packageId === pending.id);
    expect(item).toBeDefined();
    expect(item?.kind).toBe("node"); // 小写口径
    expect(item?.author).toEqual({ id: owner.id, name: owner.email.split("@")[0] }); // owner 聚合＋脱敏
    expect(item?.perms).toEqual(["CDP", "网络"]);
    expect(item?.semver).toBe("1.0.0");
    expect(item?.sizeBytes).toBe(await sizeBytesOf(pending));
    expect(typeof item?.createdAt).toBe("string");
    expect(body.items.some((i) => i.packageId === approved.id)).toBe(false); // APPROVED 不入 pending 队
  });

  it("默认 status=pending；approved/offline 过滤生效；非法查询参 → 400", async () => {
    const approved = await seedPackage("APPROVED");
    const offline = await seedPackage("OFFLINE");
    createdPackageIds.push(approved.id, offline.id);

    const def = await app.request("/api/admin/reviews", { headers: auth(admin.accessToken) });
    const defBody = (await def.json()) as { items: Array<{ packageId: string }> };
    expect(def.status).toBe(200);
    expect(defBody.items.some((i) => i.packageId === approved.id)).toBe(false);

    const byStatus = await app.request("/api/admin/reviews?status=approved", { headers: auth(admin.accessToken) });
    const sBody = (await byStatus.json()) as { items: Array<{ packageId: string; kind: string }> };
    expect(sBody.items.some((i) => i.packageId === approved.id)).toBe(true);
    expect(sBody.items.some((i) => i.packageId === offline.id)).toBe(false);

    const off = await app.request("/api/admin/reviews?status=offline", { headers: auth(admin.accessToken) });
    const oBody = (await off.json()) as { items: Array<{ packageId: string }> };
    expect(oBody.items.some((i) => i.packageId === offline.id)).toBe(true);

    const bad = await app.request("/api/admin/reviews?status=bogus", { headers: auth(admin.accessToken) });
    expect(bad.status).toBe(400);
  });

  it("分页：pageSize=1&page=2 出第二件（非第一页重复）且 total ≥ 队列规模", async () => {
    const [a, b] = await seedPackage("PENDING").then(async (x) => [x, await seedPackage("PENDING")] as const);
    createdPackageIds.push(a.id, b.id);
    const page1 = (await (await app.request("/api/admin/reviews?status=pending&pageSize=1&page=1", { headers: auth(admin.accessToken) })).json()) as { items: Array<{ packageId: string }>; total: number };
    const page2 = (await (await app.request("/api/admin/reviews?status=pending&pageSize=1&page=2", { headers: auth(admin.accessToken) })).json()) as { items: Array<{ packageId: string }>; total: number };
    expect(page1.items).toHaveLength(1);
    expect(page2.items).toHaveLength(1);
    // 全局 total 在并行套件写入下非恒定——断言结构性事实（覆盖 ≥ 自有种子的规模、页间不重复）
    expect(page1.total).toBeGreaterThanOrEqual(2);
    expect(page2.total).toBeGreaterThanOrEqual(2);
    const page1Ids = page1.items.map((i) => i.packageId);
    expect(page2.items.every((i) => !page1Ids.includes(i.packageId))).toBe(true); // 第二页非第一页重复
  });
});

describe("review workbench（GET /api/admin/packages/:id）", () => {
  it("AdminPackageDetail：manifest 原文/脚本键集/versions/计量计数/状态小写", async () => {
    const seeded = await seedPackage("PENDING");
    createdPackageIds.push(seeded.id);
    await prisma.package.update({ where: { id: seeded.id }, data: { downloadCount: 3, installCount: 2 } });

    const res = await app.request(`/api/admin/packages/${seeded.id}`, { headers: auth(admin.accessToken) });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      id: string; kind: string; status: string; perms: string[];
      downloadCount: number; installCount: number; starCount: number;
      versions: Array<{ semver: string; createdAt: string; sizeBytes: number; checksum: string }>;
      manifest: { kind: string; name: string; version: string; scripts?: Record<string, unknown> };
    };
    expect(detail.id).toBe(seeded.id);
    expect(detail.kind).toBe("node");
    expect(detail.status).toBe("pending");
    expect(detail.perms).toEqual(["CDP", "网络"]);
    expect(detail.downloadCount).toBe(3);
    expect(detail.installCount).toBe(2);
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0]?.semver).toBe("1.0.0");
    // manifest 原文（含 scripts）——脚本清单键集客户端自 manifest.scripts 派生
    expect(detail.manifest.kind).toBe("node");
    expect(Object.keys(detail.manifest.scripts ?? {})).toEqual(["custom.wb"]);

    // RBAC：USER token → 403
    const forbidden = await app.request(`/api/admin/packages/${seeded.id}`, { headers: auth(plainUser.accessToken) });
    expect(forbidden.status).toBe(403);
  });

  it("不存在 → 404 NOT-FOUND", async () => {
    const res = await app.request(`/api/admin/packages/${randomUUID()}`, { headers: auth(admin.accessToken) });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT-FOUND");
  });
});

describe("download 预检（GET /api/admin/packages/:id/download）", () => {
  it("流式 zip＋Content-Disposition（PENDING 可预检——审核对象即待审包）；字节一致", async () => {
    const seeded = await seedPackage("PENDING", { withObject: true });
    createdPackageIds.push(seeded.id);
    seededKeys.push(seeded.storageKey);

    const res = await app.request(`/api/admin/packages/${seeded.id}/download`, { headers: auth(admin.accessToken) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="1.0.0.zip"');
    const bytes = Buffer.from(await res.arrayBuffer());
    // 与落盘对象一致（同一 zip 构建口径：manifest+nodes+scripts 四件套）
    const expectBytes = await (async () => {
      const v = await prisma.packageVersion.findFirstOrThrow({ where: { packageId: seeded.id } });
      const stream = await getStorage().getStream(v.storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return Buffer.concat(chunks);
    })();
    expect(bytes.equals(expectBytes)).toBe(true);

    // 预检不计入市场计量（downloadCount 不动——计量属 S-02 download 端点）
    const pkg = await prisma.package.findUnique({ where: { id: seeded.id }, select: { downloadCount: true } });
    expect(pkg?.downloadCount).toBe(0);
  });

  it("对象缺失（DB 行在、存储无）→ 404；包不存在 → 404；无版本行 → 404", async () => {
    const noObject = await seedPackage("PENDING"); // 未落盘
    createdPackageIds.push(noObject.id);
    const res = await app.request(`/api/admin/packages/${noObject.id}/download`, { headers: auth(admin.accessToken) });
    expect(res.status).toBe(404);

    const missing = await app.request(`/api/admin/packages/${randomUUID()}/download`, { headers: auth(admin.accessToken) });
    expect(missing.status).toBe(404);

    const barePkg = await prisma.package.create({
      data: { kind: "PACK", name: `裸包-${randomUUID().slice(0, 6)}`, ownerUserId: owner.id, status: "PENDING", perms: [] },
    });
    createdPackageIds.push(barePkg.id);
    const bare = await app.request(`/api/admin/packages/${barePkg.id}/download`, { headers: auth(admin.accessToken) });
    expect(bare.status).toBe(404);
  });
});

describe("E2E B-11（A 发布→202 PENDING→admin 通过→B download 200 downloadCount=1→installs ok）", () => {
  /** Buffer → BlobPart（@types/node 25 泛型化 TypedArray 后 Buffer 不直赋） */
  function toBlobPart(buf: Buffer): ArrayBuffer {
    const arrayBuffer = new ArrayBuffer(buf.byteLength);
    new Uint8Array(arrayBuffer).set(buf);
    return arrayBuffer;
  }

  it("全链路（对隧道 PG 真跑；multipart 发布→审核→下载→安装计量）", async () => {
    // A（作者）与 B（安装者）经真实注册/登录
    const authorA = await createUser();
    const userB = await createUser();

    // A 发布（multipart zip 四件套）
    const zipBytes = samplePackageZip({ name: "B11链路包", nodes: [{ type: "custom.b11", category: "AI" }] });
    const form = new FormData();
    form.append("file", new File([toBlobPart(zipBytes)], "b11.zip", { type: "application/zip" }));
    form.append("meta", JSON.stringify({ kind: "node", name: "B11链路包", summary: "端到端" }));
    const publishRes = await app.request("/api/market/packages", { method: "POST", headers: auth(authorA.accessToken), body: form });
    expect(publishRes.status).toBe(202);
    const accepted = (await publishRes.json()) as { packageId: string; status: string; perms: string[]; checksum: string };
    createdPackageIds.push(accepted.packageId);
    expect(accepted.status).toBe("pending");
    expect(accepted.perms).toEqual(["AI"]);

    // admin 从待审队列看到该包（真实守卫链）
    const queueRes = await app.request("/api/admin/reviews?status=pending", { headers: auth(admin.accessToken) });
    const queueBody = (await queueRes.json()) as { items: Array<{ packageId: string }> };
    expect(queueBody.items.some((i) => i.packageId === accepted.packageId)).toBe(true);

    // admin 审核通过
    const decideRes = await app.request(`/api/admin/packages/${accepted.packageId}/review`, {
      method: "POST", headers: { ...auth(admin.accessToken), ...JSON_HEADERS }, body: JSON.stringify({ action: "approve" }),
    });
    expect(decideRes.status).toBe(200);
    expect(((await decideRes.json()) as { status: string }).status).toBe("approved");

    // B 下载 → 200 字节一致 且 downloadCount=1
    const dlRes = await app.request(`/api/market/packages/${accepted.packageId}/download`, { headers: auth(userB.accessToken) });
    expect(dlRes.status).toBe(200);
    const dlBytes = Buffer.from(await dlRes.arrayBuffer());
    expect(dlBytes.equals(zipBytes)).toBe(true);
    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: accepted.packageId }, select: { downloadCount: true, installCount: true } });
    expect(pkg.downloadCount).toBe(1);

    // B 安装计量 → {ok}
    const installRes = await app.request(`/api/market/packages/${accepted.packageId}/installs`, {
      method: "POST", headers: auth(userB.accessToken), body: "{}",
    });
    expect(installRes.status).toBe(200);
    expect(((await installRes.json()) as { ok: boolean }).ok).toBe(true);
    const after = await prisma.package.findUniqueOrThrow({ where: { id: accepted.packageId }, select: { installCount: true } });
    expect(after.installCount).toBe(1);
  });
});

/**
 * ReviewQueueService＋PackageInspection（TDD-S-03 §3；T2-09）。
 * 队列=status 过滤＋owner 聚合分页（items 元素形=ReviewQueueItem，X-01 冻结）；
 * 工作台=manifest 原文摘要/versions 清单（脚本键集随 manifest.scripts 客户端可派生）/计量计数
 * → AdminPackageDetail 形；下载预检=经 S-05 getStream（StorageNotFound→404——预检对象不可得同语义）。
 * 域隔离：kind/author 映射为本地字面量映射（不 import S-02 业务模块——P-3 域间禁业务互调）。
 */
import type { Readable } from "node:stream";
import type {
  AdminPackageDetail,
  MarketAuthor,
  PackageStatus as DtoPackageStatus,
  PermLabel,
  ReviewQueueItem,
  ReviewQueueRes,
} from "@constella/shared/dto";
import type { PackageManifest } from "@constella/shared/manifest";
import { ApiError } from "../../kernel/errors.js";
import { getStorage } from "../../infra/storage/storage.factory.js";
import { StorageNotFound } from "../../infra/storage/storage.types.js";
import { prisma } from "../../utils/prisma.js";
import type { QueueQuery } from "./review.schemas.js";

/** kind 小写 ↔ Prisma 枚举大写（本地映射——与 S-02 同规则、不跨域 import） */
const KIND_FROM_ENUM = { NODE: "node", PACK: "pack", FLOW: "flow" } as const;

/** status 小写（查询参）↔ Prisma 枚举大写 */
const STATUS_TO_ENUM = {
  pending: "PENDING",
  approved: "APPROVED",
  rejected: "REJECTED",
  offline: "OFFLINE",
} as const;

/** owner → 脱敏作者（email 本地部分；与 S-02 同口径） */
function toAuthor(owner: { id: string; email: string }): MarketAuthor {
  const local = owner.email.split("@")[0];
  return { id: owner.id, name: local && local.length > 0 ? local : owner.email };
}

/** GET /admin/reviews —— 队列分页（status 过滤＋owner 聚合；提交时间新→旧） */
export async function queue(query: QueueQuery): Promise<ReviewQueueRes> {
  const where = { status: STATUS_TO_ENUM[query.status], latestVersionId: { not: null } };
  const [total, rows] = await prisma.$transaction([
    prisma.package.count({ where }),
    prisma.package.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { owner: true, latestVersion: true },
    }),
  ]);
  const items: ReviewQueueItem[] = rows
    .filter((r) => r.latestVersion !== null)
    .map((r) => ({
      packageId: r.id,
      kind: KIND_FROM_ENUM[r.kind],
      name: r.name,
      summary: r.summary ?? undefined,
      author: toAuthor(r.owner),
      perms: r.perms as PermLabel[],
      sizeBytes: r.latestVersion!.sizeBytes,
      semver: r.latestVersion!.semver,
      createdAt: r.createdAt.toISOString(),
    }));
  return { items, total };
}

/** GET /admin/packages/:id —— 工作台包详情聚合（AdminPackageDetail） */
export async function inspectPackage(packageId: string): Promise<AdminPackageDetail> {
  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    include: { owner: true, latestVersion: true, versions: { orderBy: { createdAt: "asc" } } },
  });
  if (!pkg || !pkg.latestVersion) {
    // 无版本行的包无可审内容（发布管线恒建版本——防御性 404）
    throw new ApiError("NOT-FOUND");
  }
  return {
    id: pkg.id,
    kind: KIND_FROM_ENUM[pkg.kind],
    name: pkg.name,
    summary: pkg.summary ?? undefined,
    author: toAuthor(pkg.owner),
    perms: pkg.perms as PermLabel[],
    status: pkg.status.toLowerCase() as DtoPackageStatus,
    downloadCount: pkg.downloadCount,
    installCount: pkg.installCount,
    starCount: pkg.starCount,
    updatedAt: pkg.updatedAt.toISOString(),
    versions: pkg.versions.map((v) => ({
      semver: v.semver,
      createdAt: v.createdAt.toISOString(),
      sizeBytes: v.sizeBytes,
      checksum: v.checksum,
    })),
    manifest: pkg.latestVersion.manifest as unknown as PackageManifest,
  };
}

export interface PackageStream {
  stream: Readable;
  semver: string;
}

/** GET /admin/packages/:id/download —— 下载预检流（经 S-05 getStream；全状态可预检——审核对象含 PENDING） */
export async function openPackageStream(packageId: string): Promise<PackageStream> {
  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    include: { latestVersion: true },
  });
  if (!pkg || !pkg.latestVersion) {
    throw new ApiError("NOT-FOUND");
  }
  try {
    const stream = await getStorage().getStream(pkg.latestVersion.storageKey);
    return { stream, semver: pkg.latestVersion.semver };
  } catch (err) {
    if (err instanceof StorageNotFound) {
      // DB 有行而对象缺失=存储失配——预检按不可得处理（404），不外泄 500 细节
      throw new ApiError("NOT-FOUND");
    }
    throw err;
  }
}

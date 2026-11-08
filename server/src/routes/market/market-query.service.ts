/**
 * MarketQueryService（TDD-S-02 §3；T2-05）：列表（过滤/ILIKE 搜索/排序/分页）、详情聚合、
 * 我的发布（T2-06 增补——全状态＋驳回理由可见=PRD-A13-02）。
 * 过滤=status='APPROVED' 且 latestVersion 非空（复审期包从列表隐藏——03 S-02 §1 ⚠ a 默认）。
 * author={id,name:email 本地部分}（脱敏；✅ M4 #8③ 冻结识）。
 */
import type {
  MarketListItem,
  MarketMineItem,
  PackageDetail,
  PackageStatus as DtoPackageStatus,
  PermLabel,
} from "@constella/shared/dto";
import type { Package } from "../../../generated/prisma/client.js";
import { ApiError } from "../../kernel/errors.js";
import { prisma } from "../../utils/prisma.js";
import { KIND_FROM_ENUM, KIND_TO_ENUM } from "./market.schemas.js";
import type { ListQuery, PublishMeta } from "./market.schemas.js";

/** 列表/详情通用 include（owner 出 author；latestVersion 出列表 version 指针） */
const BASE_INCLUDE = { owner: true, latestVersion: true } as const;

/** owner → 脱敏作者（email 本地部分） */
function toAuthor(owner: { id: string; email: string }): { id: string; name: string } {
  const local = owner.email.split("@")[0];
  return { id: owner.id, name: local && local.length > 0 ? local : owner.email };
}

/** DB 行 → MarketListItem（kind 枚举大写→DTO 小写；perms 六标签封闭集直传） */
function toListItem(
  pkg: Package & { owner: { id: string; email: string }; latestVersion: { semver: string } | null },
): MarketListItem {
  return {
    id: pkg.id,
    kind: KIND_FROM_ENUM[pkg.kind],
    name: pkg.name,
    summary: pkg.summary ?? undefined,
    author: toAuthor(pkg.owner),
    perms: pkg.perms as PermLabel[],
    downloadCount: pkg.downloadCount,
    installCount: pkg.installCount,
    starCount: pkg.starCount,
    version: pkg.latestVersion?.semver ?? "",
    updatedAt: pkg.updatedAt.toISOString(),
  };
}

/** 列表查询（匿名浏览 D-1；过滤/搜索/排序/分页） */
export async function list(query: ListQuery): Promise<{ items: MarketListItem[]; total: number }> {
  const where = {
    status: "APPROVED" as const,
    latestVersionId: { not: null },
  };
  if (query.kind) {
    (where as Record<string, unknown>).kind = KIND_TO_ENUM[query.kind];
  }
  if (query.q) {
    // ILIKE 搜索（PG contains insensitive；命中 name 或 summary）
    (where as Record<string, unknown>).OR = [
      { name: { contains: query.q, mode: "insensitive" as const } },
      { summary: { contains: query.q, mode: "insensitive" as const } },
    ];
  }
  const orderBy =
    query.sort === "downloads" ? { downloadCount: "desc" as const } : { updatedAt: "desc" as const };

  const [total, rows] = await prisma.$transaction([
    prisma.package.count({ where }),
    prisma.package.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: BASE_INCLUDE,
    }),
  ]);
  return { total, items: rows.filter((r) => r.latestVersion !== null).map(toListItem) };
}

/** 详情：包基础信息 + versions[{semver,createdAt,sizeBytes,checksum}] + perms（versions 元素形=✅ M4 #8④）。
 * 非 APPROVED 一律 404 MARKET-PACKAGE-NOT-FOUND（不泄露存在性——PRD-A13-02 审核通过前不可见；下载另有
 * MARKET-PACKAGE-NOT-APPROVED 语义，02 §12.4）。 */
export async function detail(id: string): Promise<PackageDetail> {
  const pkg = await prisma.package.findUnique({
    where: { id },
    include: { ...BASE_INCLUDE, versions: { orderBy: { createdAt: "asc" } } },
  });
  if (!pkg || pkg.status !== "APPROVED" || !pkg.latestVersion) {
    throw new ApiError("MARKET-PACKAGE-NOT-FOUND");
  }
  return {
    ...toListItem(pkg),
    versions: pkg.versions.map((v) => ({
      semver: v.semver,
      createdAt: v.createdAt.toISOString(),
      sizeBytes: v.sizeBytes,
      checksum: v.checksum,
    })),
  };
}

/** 我的发布（requireActiveUser；全状态＋驳回理由可见）。
 * ⚠ 上报：X-01 dto/market MarketMineItem 现形仅 {status}——03 S-02 §1/PRD-A13-02 要求 reviewReason?，
 * 本响应按 03 卡补发 reviewReason（shared DTO 的超集，客户端兼容；shared 增补走 X-01 变更）。 */
export async function mine(userId: string): Promise<{
  items: Array<MarketMineItem & { reviewReason?: string }>;
  total: number;
}> {
  const rows = await prisma.package.findMany({
    where: { ownerUserId: userId },
    orderBy: { updatedAt: "desc" },
    include: BASE_INCLUDE,
  });

  // 驳回理由：REJECTED 包取最新 REJECT 留痕 reason（ReviewRecord 数据层共享读——域间禁业务互调，表读合法）
  const rejectedIds = rows.filter((r) => r.status === "REJECTED").map((r) => r.id);
  const reasonByPackage = new Map<string, string>();
  if (rejectedIds.length > 0) {
    const records = await prisma.reviewRecord.findMany({
      where: { packageId: { in: rejectedIds }, action: "REJECT" },
      orderBy: { createdAt: "desc" },
    });
    for (const rec of records) {
      if (!reasonByPackage.has(rec.packageId) && rec.reason) {
        reasonByPackage.set(rec.packageId, rec.reason);
      }
    }
  }

  const items: Array<MarketMineItem & { reviewReason?: string }> = rows.map((r) => {
    const item: MarketMineItem & { reviewReason?: string } = {
      ...toListItem(r),
      status: r.status.toLowerCase() as DtoPackageStatus,
    };
    if (r.status === "REJECTED") {
      const reason = reasonByPackage.get(r.id);
      if (reason) item.reviewReason = reason;
    }
    return item;
  });
  return { items, total: items.length };
}

/** 发布管线再发布匹配（同 owner+kind+name 复用包；03 S-02 §1 ⚠ a）——数据面查询，供 PublishPipeline */
export function findOwnedPackage(userId: string, meta: PublishMeta) {
  return prisma.package.findFirst({
    where: { ownerUserId: userId, kind: KIND_TO_ENUM[meta.kind], name: meta.name },
    include: { versions: true },
  });
}

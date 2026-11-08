/**
 * PublishPipeline（TDD-S-02 §3/§1；T2-06）：发布处理序①~⑥编排（顺序不可换，02 §6.4 冻结）。
 * ①大小/类型校验（zip、总量 ≤20MB）→ ②解包安全（ManifestGuard.readZipEntries 规则）→
 * ③manifest 解析+perms 推导 → ④StorageAdapter.put → ⑤Package(PENDING)+PackageVersion 落库 → ⑥202。
 * 幂等：同 owner 同 SHA-256 → 202 返回既有 packageId 不新建（02 §1.3 补交语义）。
 * semver（D-11）：首发必须 1.0.0（违者 400 MARKET-FILE-INVALID）；再发布须大于既有最大（违者 409 CONFLICT，
 * 撞既有 semver 由 @@unique(packageId,semver)→P2002→409 结构面兜底）。
 * 再发布＝复用包＋新版本＋status 重置 PENDING（复审期包从列表隐藏＝APPROVED 过滤天然生效）。
 */
import { createHash, randomUUID } from "node:crypto";
import type { PermLabel } from "@constella/shared/dto";
import type { PackageStatus as DtoPackageStatus } from "@constella/shared/dto";
import { Prisma } from "../../../generated/prisma/client.js";
import { ApiError } from "../../kernel/errors.js";
import { getStorage } from "../../infra/storage/storage.factory.js";
import { isUniqueViolation } from "../auth/token.service.js";
import { prisma } from "../../utils/prisma.js";
import { findOwnedPackage } from "./market-query.service.js";
import { KIND_TO_ENUM } from "./market.schemas.js";
import type { PublishMeta } from "./market.schemas.js";
import { compareSemver, inspectZip, MAX_ARCHIVE_BYTES, normalizeSemver } from "./manifest-guard.js";

/** 上传文件形（路由层从 multipart 提取） */
export interface PublishFile {
  data: Buffer;
  filename: string;
  contentType: string;
}

/** 202 响应（形=X-01 PublishAccepted；幂等命中时 status=包当前实际状态小写） */
export interface PublishResult {
  packageId: string;
  status: DtoPackageStatus;
  perms: PermLabel[];
  checksum: string;
}

function checksumOf(data: Buffer): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

/** ① 大小/类型校验：zip 且 ≤20MB（超限/非 zip → 400 MARKET-FILE-INVALID） */
function assertUploadable(file: PublishFile): void {
  const looksZip = /\.zip$/i.test(file.filename) || /zip/i.test(file.contentType);
  if (!looksZip || file.data.length === 0 || file.data.length > MAX_ARCHIVE_BYTES) {
    throw new ApiError("MARKET-FILE-INVALID", "package must be a zip archive up to 20MB");
  }
}

/** semver 规则裁定（D-11/PRD-CUSTOM-N8）：首发必须 1.0.0；再发布须大于既有最大 */
function assertSemverAllowed(semver: string, maxExisting: string | null): void {
  if (maxExisting === null) {
    if (semver !== "1.0.0") {
      throw new ApiError("MARKET-FILE-INVALID", "first publish must use semver 1.0.0");
    }
    return;
  }
  if (compareSemver(semver, maxExisting) <= 0) {
    throw new ApiError("CONFLICT", `semver must be greater than ${maxExisting}`);
  }
}

/** 处理序编排＋checksum 幂等＋再发布匹配＋事务落库 */
export async function publish(userId: string, file: PublishFile, meta: PublishMeta): Promise<PublishResult> {
  // ① 大小/类型
  assertUploadable(file);
  const checksum = checksumOf(file.data);

  // 幂等短路：同 owner 同 SHA-256 已存在 → 202 既有 packageId 不新建（未过安全校验的字节集不可能先落库，
  // 同 bytes 复现同裁决；短路在解包前省 CPU）
  const existingVersion = await prisma.packageVersion.findFirst({
    where: { checksum, package: { ownerUserId: userId } },
    include: { package: true },
  });
  if (existingVersion) {
    return {
      packageId: existingVersion.packageId,
      status: existingVersion.package.status.toLowerCase() as DtoPackageStatus,
      perms: existingVersion.package.perms as PermLabel[],
      checksum,
    };
  }

  // ②③ 解包安全 + manifest Zod + perms 推导
  const inspected = inspectZip(file.data);
  const manifest = inspected.manifest;
  const semver = normalizeSemver(manifest.version);

  // meta ↔ manifest 一致性（发布表单与包内声明同源——C-08 exportPackage 同一 meta 生成；
  // 不一致=包被调包或表单伪造 → 400）
  if (manifest.kind !== meta.kind || manifest.name !== meta.name) {
    throw new ApiError("MARKET-FILE-INVALID", "meta does not match manifest");
  }

  // 再发布匹配（同 owner+kind+name）+ semver 规则
  const owned = await findOwnedPackage(userId, meta);
  const maxExisting =
    owned && owned.versions.length > 0
      ? owned.versions.map((v) => v.semver).reduce((max, v) => (compareSemver(v, max) > 0 ? v : max))
      : null;
  assertSemverAllowed(semver, maxExisting);

  // ④ 存储（键=packages/<packageId>/<semver>.zip，02 §5.3；落库失败遗留对象由同键重试覆盖，无害）
  const packageId = owned?.id ?? randomUUID();
  const storageKey = `packages/${packageId}/${semver}.zip`;
  const storage = getStorage();
  await storage.put(storageKey, file.data, { contentType: "application/zip", checksum });

  // ⑤ 落库（新包=create+首版本；再发布=新版本+status 重置 PENDING；同事务置 isAuthor——D-1 两态）
  const manifestJson = manifest as unknown as Prisma.InputJsonValue;
  try {
    // 交互事务：高延迟链路（SSH 隧道开发形态）下放宽起事务窗口（语义不变）
    await prisma.$transaction(
      async (tx) => {
        if (owned) {
          const version = await tx.packageVersion.create({
            data: { packageId, semver, storageKey, checksum, sizeBytes: inspected.sizeBytes, manifest: manifestJson },
          });
          await tx.package.update({
            where: { id: packageId },
            data: { status: "PENDING", latestVersionId: version.id },
          });
        } else {
          // latestVersion FK 在父行上（latestVersionId）——两步建：先包后版本再回填指针（同事务）
          await tx.package.create({
            data: {
              id: packageId,
              kind: KIND_TO_ENUM[meta.kind],
              name: meta.name,
              summary: meta.summary ?? null,
              ownerUserId: userId,
              status: "PENDING",
              perms: inspected.perms,
            },
          });
          const version = await tx.packageVersion.create({
            data: { packageId, semver, storageKey, checksum, sizeBytes: inspected.sizeBytes, manifest: manifestJson },
          });
          await tx.package.update({ where: { id: packageId }, data: { latestVersionId: version.id } });
        }
        await tx.user.update({ where: { id: userId }, data: { isAuthor: true } });
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError("CONFLICT"); // (packageId,semver) 撞既有（并发再发布同 semver）
    }
    throw err;
  }

  // ⑥ 202
  return { packageId, status: "pending", perms: inspected.perms, checksum };
}

/**
 * T2-13 验收：download 能力协商 s3 分支（mock 单测——不发真请求、不依赖 MinIO）。
 * 预签名策略②：driver=s3 → 302 signedUrl；策略③：鉴权与计量在 302 发放之前完成。
 * mock 面=storage.factory（getStorage 返回桩适配器：signedUrl 恒成功）——
 * 业务层零感知实现的切换无感证据（S-05 §6.2 收口：disk 侧流式已在 market-download.test 覆盖）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const stubStorage = vi.hoisted(() => ({
  put: vi.fn(async (key: string) => ({ key, sizeBytes: 0 })),
  signedUrl: vi.fn(async (key: string) => `https://s3.example.test/${key}?X-Amz-Algorithm=stub`),
  getStream: vi.fn(async () => {
    throw new Error("getStream must not be called when signedUrl is supported");
  }),
  delete: vi.fn(async () => undefined),
}));

vi.mock("../../infra/storage/storage.factory.js", () => ({
  getStorage: () => stubStorage,
  resetStorageForTests: () => undefined,
}));

import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { resetRateLimitForTests } from "../../kernel/rate-limit.js";
import { prisma } from "../../utils/prisma.js";

const app = buildApp();
const EMAIL_PREFIX = "vitest-market-302-";
const JSON_HEADERS = { "content-type": "application/json" };

function uniqueEmail(): string {
  return `${EMAIL_PREFIX}${randomUUID()}@test.local`;
}

async function createUser(): Promise<{ id: string; accessToken: string }> {
  const email = uniqueEmail();
  await app.request("/api/auth/register", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email, password: "12345678" }) });
  const login = (await (await app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email, password: "12345678" }) })).json()) as { accessToken: string; user: { id: string } };
  return { id: login.user.id, accessToken: login.accessToken };
}

let packageId = "";
let downloader: { id: string; accessToken: string };

beforeAll(async () => {
  const owner = await createUser();
  downloader = await createUser();
  const pkg = await prisma.package.create({
    data: { kind: "NODE", name: `302包-${randomUUID().slice(0, 8)}`, ownerUserId: owner.id, status: "APPROVED", perms: [] },
  });
  packageId = pkg.id;
  const version = await prisma.packageVersion.create({
    data: {
      packageId: pkg.id,
      semver: "1.0.0",
      storageKey: `packages/${pkg.id}/1.0.0.zip`,
      checksum: `sha256:${randomUUID()}`,
      sizeBytes: 100,
      manifest: { kind: "node", name: "302包", version: "1.0.0" },
    },
  });
  await prisma.package.update({ where: { id: pkg.id }, data: { latestVersionId: version.id } });
});

afterAll(async () => {
  // T6-17 清扫健壮性：user 删除移出 pkgIds 空集守卫（无包用户不再漏删）＋两轮清扫
  // 防 in-flight 写入漏删（storage 为 stub——无对象清理面）。
  for (let round = 0; round < 2; round++) {
    const users = await prisma.user.findMany({ where: { email: { startsWith: EMAIL_PREFIX } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) break;
    const pkgs = await prisma.package.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
    const pkgIds = pkgs.map((p) => p.id);
    if (pkgIds.length > 0) {
      await prisma.package.updateMany({ where: { id: { in: pkgIds } }, data: { latestVersionId: null } });
      await prisma.$transaction([
        prisma.packageVersion.deleteMany({ where: { packageId: { in: pkgIds } } }),
        prisma.reviewRecord.deleteMany({ where: { packageId: { in: pkgIds } } }),
        prisma.downloadStat.deleteMany({ where: { packageId: { in: pkgIds } } }),
        prisma.package.deleteMany({ where: { id: { in: pkgIds } } }),
      ]);
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

describe("download capability negotiation (s3 → 302)", () => {
  it("signedUrl 可用 → 302 Location=签名 URL；计量先行（downloadCount +1）；不走流式", async () => {
    resetRateLimitForTests();
    const before = await prisma.package.findUnique({ where: { id: packageId }, select: { downloadCount: true } });
    const res = await app.request(`/api/market/packages/${packageId}/download`, {
      headers: { authorization: `Bearer ${downloader.accessToken}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://s3.example.test/packages/${packageId}/1.0.0.zip?X-Amz-Algorithm=stub`);

    const after = await prisma.package.findUnique({ where: { id: packageId }, select: { downloadCount: true } });
    expect(after?.downloadCount).toBe((before?.downloadCount ?? 0) + 1); // 策略③：发放前计量
    expect(stubStorage.getStream).not.toHaveBeenCalled(); // 能力协商走 signedUrl 分支
  });

  it("PENDING 包在 s3 模式下仍 404（鉴权/可见性在 302 之前——预签名不豁免）", async () => {
    const owner = await prisma.user.findFirst({ where: { email: { startsWith: EMAIL_PREFIX } } });
    const pkg = await prisma.package.create({
      data: { kind: "NODE", name: `302待审-${randomUUID().slice(0, 8)}`, ownerUserId: owner!.id, status: "PENDING", perms: [] },
    });
    const res = await app.request(`/api/market/packages/${pkg.id}/download`, {
      headers: { authorization: `Bearer ${downloader.accessToken}` },
    });
    expect(res.status).toBe(404);
    expect(stubStorage.signedUrl).not.toHaveBeenCalledWith(`packages/${pkg.id}/1.0.0.zip`, expect.anything());
    await prisma.package.delete({ where: { id: pkg.id } }); // 无版本行，直接清
  });
});

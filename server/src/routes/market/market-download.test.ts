/**
 * T2-07 验收：download/installs 计量＋下载＋OpenAPI（TDD-S-02 §6.1b/c＋§6.2）。
 * b) PENDING 包 download → 404 MARKET-PACKAGE-NOT-APPROVED；APPROVED → disk 流式（Content-Disposition）＋
 *    DownloadStat(DOWNLOAD)＋downloadCount 原子 +1；
 * c) 同 user 同包同日两次 installs → installCount 恰 +1（幂等窗 userId+packageId+day）；
 * §6.2 GET /api/openapi.json → 200 且 paths 含全部 6 个 market 端点。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { resetRateLimitForTests } from "../../kernel/rate-limit.js";
import { getStorage } from "../../infra/storage/storage.factory.js";
import { prisma } from "../../utils/prisma.js";
import { samplePackageZip } from "./testing/zip-builder.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const app = buildApp();
const EMAIL_PREFIX = "vitest-market-dl-";
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

const ZIP_BYTES = samplePackageZip({ name: "下载包", nodes: [{ type: "custom.dl", category: "网络" }] });

let approvedId = "";
let pendingId = "";
let owner: { id: string; accessToken: string };
let userB: { id: string; accessToken: string };
let userC: { id: string; accessToken: string };

async function seedPackage(status: "APPROVED" | "PENDING"): Promise<string> {
  const pkg = await prisma.package.create({
    data: { kind: "NODE", name: `计量包-${status}-${randomUUID().slice(0, 8)}`, ownerUserId: owner.id, status, perms: ["网络"] },
  });
  const version = await prisma.packageVersion.create({
    data: {
      packageId: pkg.id,
      semver: "1.0.0",
      storageKey: `packages/${pkg.id}/1.0.0.zip`,
      checksum: `sha256:${randomUUID()}`,
      sizeBytes: ZIP_BYTES.length,
      manifest: { kind: "node", name: "下载包", version: "1.0.0" },
    },
  });
  await prisma.package.update({ where: { id: pkg.id }, data: { latestVersionId: version.id } });
  await getStorage().put(version.storageKey, ZIP_BYTES, { contentType: "application/zip", checksum: version.checksum });
  return pkg.id;
}

async function download(id: string, token: string): Promise<Response> {
  return app.request(`/api/market/packages/${id}/download`, { headers: { authorization: `Bearer ${token}` } });
}

async function install(id: string, token: string): Promise<Response> {
  return app.request(`/api/market/packages/${id}/installs`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" });
}

beforeAll(async () => {
  owner = await createUser();
  userB = await createUser();
  userC = await createUser();
  approvedId = await seedPackage("APPROVED");
  pendingId = await seedPackage("PENDING");
});

beforeEach(() => {
  resetRateLimitForTests();
});

afterAll(async () => {
  // T6-17 清扫健壮性：按 ownerUserId 全量查清（用户邮箱前缀→名下包→版本/审核/计量级联→用户）。
  // 原实现按 createdPackageIds 追踪数组删——用例半途失败/漏登记即残留行，user 删除被
  // Package.ownerUserId FK 拦截（T5-11 留痕转交项）。两轮清扫防 in-flight 写入漏删。
  for (let round = 0; round < 2; round++) {
    const users = await prisma.user.findMany({ where: { email: { startsWith: EMAIL_PREFIX } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) break;
    const pkgs = await prisma.package.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
    const pkgIds = pkgs.map((p) => p.id);
    const versions = pkgIds.length > 0 ? await prisma.packageVersion.findMany({ where: { packageId: { in: pkgIds } } }) : [];
    const storage = getStorage();
    for (const v of versions) {
      await storage.delete(v.storageKey).catch(() => undefined);
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
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

describe("market download", () => {
  it("b) PENDING 包 → 404 MARKET-PACKAGE-NOT-APPROVED（02 §12.4 未审核包拦截）", async () => {
    const res = await download(pendingId, userB.accessToken);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("MARKET-PACKAGE-NOT-APPROVED");
  });

  it("不存在 → 404 MARKET-PACKAGE-NOT-FOUND；无 token → 401", async () => {
    const missing = await download(randomUUID(), userB.accessToken);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("MARKET-PACKAGE-NOT-FOUND");

    const noAuth = await download(approvedId, "");
    expect(noAuth.status).toBe(401);
  });

  it("APPROVED → 200 流式 zip＋Content-Disposition＋计量事务（downloadCount=+1/行）", async () => {
    const before = await prisma.package.findUnique({ where: { id: approvedId }, select: { downloadCount: true } });
    const res = await download(approvedId, userB.accessToken);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="1.0.0.zip"');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(ZIP_BYTES)).toBe(true);

    const after = await prisma.package.findUnique({ where: { id: approvedId }, select: { downloadCount: true } });
    expect(after?.downloadCount).toBe((before?.downloadCount ?? 0) + 1);
    const stats = await prisma.downloadStat.count({ where: { packageId: approvedId, type: "DOWNLOAD", userId: userB.id } });
    expect(stats).toBe(1);
  });

  it("重复下载持续计数（30/min 限流内）", async () => {
    const res = await download(approvedId, userB.accessToken);
    expect(res.status).toBe(200);
    const pkg = await prisma.package.findUnique({ where: { id: approvedId }, select: { downloadCount: true } });
    expect(pkg?.downloadCount).toBeGreaterThanOrEqual(2);
  });
});

describe("market installs", () => {
  it("c) 同 user 同包同日两次 → installCount 恰 +1、两次均 {ok}", async () => {
    const before = await prisma.package.findUnique({ where: { id: approvedId }, select: { installCount: true } });
    const r1 = await install(approvedId, userB.accessToken);
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { ok: boolean }).ok).toBe(true);
    const r2 = await install(approvedId, userB.accessToken);
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { ok: boolean }).ok).toBe(true); // 当日重复 {ok} 不计数

    const after = await prisma.package.findUnique({ where: { id: approvedId }, select: { installCount: true } });
    expect(after?.installCount).toBe((before?.installCount ?? 0) + 1);
    const statRows = await prisma.downloadStat.count({ where: { packageId: approvedId, type: "INSTALL", userId: userB.id } });
    expect(statRows).toBe(1);
  });

  it("不同 user 各自计量；非 APPROVED → 404 NOT-FOUND；不存在 → 404", async () => {
    const rC = await install(approvedId, userC.accessToken);
    expect(rC.status).toBe(200);
    const pkg = await prisma.package.findUnique({ where: { id: approvedId }, select: { installCount: true } });
    expect(pkg?.installCount).toBeGreaterThanOrEqual(2);

    const pending = await install(pendingId, userC.accessToken);
    expect(pending.status).toBe(404);
    expect(((await pending.json()) as { error: { code: string } }).error.code).toBe("NOT-FOUND");

    const missing = await install(randomUUID(), userC.accessToken);
    expect(missing.status).toBe(404);

    const noAuth = await app.request(`/api/market/packages/${approvedId}/installs`, { method: "POST", body: "{}" });
    expect(noAuth.status).toBe(401);
  });
});

describe("openapi", () => {
  it("§6.2 GET /api/openapi.json → 200 且 paths 含全部 6 个 market 端点", async () => {
    const res = await app.request("/api/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(spec.openapi).toMatch(/^3\.\d+\.\d+$/);
    const marketPaths = Object.keys(spec.paths).filter((p) => p.startsWith("/market"));
    expect(marketPaths.sort()).toEqual(
      ["/market/mine", "/market/packages", "/market/packages/{id}", "/market/packages/{id}/download", "/market/packages/{id}/installs"].sort(),
    );
    expect(spec.paths["/market/packages"]?.get).toBeDefined();
    expect(spec.paths["/market/packages"]?.post).toBeDefined(); // 6 端点=5 path 键 ×（GET list + POST publish 等 6 方法位）
    expect(spec.paths["/market/packages/{id}"]?.get).toBeDefined();
    expect(spec.paths["/market/packages/{id}/download"]?.get).toBeDefined();
    expect(spec.paths["/market/packages/{id}/installs"]?.post).toBeDefined();
    expect(spec.paths["/market/mine"]?.get).toBeDefined();
  });
});

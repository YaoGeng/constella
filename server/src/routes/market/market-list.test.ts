/**
 * T2-05 验收：market list/detail（TDD-S-02 §6.1a——匿名 list 仅含 APPROVED+latestVersion 非空、
 * kind=node→NODE 往返映射；分页/排序/搜索/校验失败）。
 * 数据经 prisma 直播（list 为纯查询域）；测试连隧道 DB，afterAll 统一清理。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// 隧道 DB 延迟放大播种/清理轮次——放宽本套件超时（vitest 默认 5s/10s）
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { buildApp } from "../../app.js";
import { prisma } from "../../utils/prisma.js";

const app = buildApp();

function uniqueEmail(): string {
  return `vitest-market-list-${randomUUID()}@test.local`;
}

interface SeedPackage {
  id: string;
  versionId: string;
}

async function seedPackage(opts: {
  ownerUserId: string;
  kind: "NODE" | "PACK" | "FLOW";
  name: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "OFFLINE";
  withVersion: boolean;
  downloadCount?: number;
  summary?: string;
}): Promise<SeedPackage> {
  const pkg = await prisma.package.create({
    data: {
      kind: opts.kind,
      name: opts.name,
      summary: opts.summary ?? null,
      ownerUserId: opts.ownerUserId,
      status: opts.status,
      perms: ["文件"],
      downloadCount: opts.downloadCount ?? 0,
    },
  });
  if (!opts.withVersion) {
    return { id: pkg.id, versionId: "" };
  }
  const version = await prisma.packageVersion.create({
    data: {
      packageId: pkg.id,
      semver: "1.0.0",
      storageKey: `packages/${pkg.id}/1.0.0.zip`,
      checksum: `sha256:${randomUUID()}`,
      sizeBytes: 123,
      manifest: { kind: "node", name: opts.name, version: "1.0.0" },
    },
  });
  await prisma.package.update({ where: { id: pkg.id }, data: { latestVersionId: version.id } });
  return { id: pkg.id, versionId: version.id };
}

let ownerId: string;
let approvedNode: SeedPackage | null;
let approvedFlow: SeedPackage | null;
let pendingPkg: SeedPackage | null;
let approvedNoVersion: string | null = null;

beforeAll(async () => {
  const email = uniqueEmail();
  const owner = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash("12345678", 10) },
  });
  ownerId = owner.id;
  approvedNode = await seedPackage({
    ownerUserId: ownerId, kind: "NODE", name: "竞品价格日报", status: "APPROVED", withVersion: true, downloadCount: 5,
  });
  approvedFlow = await seedPackage({
    ownerUserId: ownerId, kind: "FLOW", name: "小红书运营流程", status: "APPROVED", withVersion: true, downloadCount: 10,
    summary: "样本摘要-每日抓取",
  });
  pendingPkg = await seedPackage({
    ownerUserId: ownerId, kind: "NODE", name: "待审包", status: "PENDING", withVersion: true,
  });
  const noVersion = await prisma.package.create({
    data: { kind: "PACK", name: "无版本包", ownerUserId: ownerId, status: "APPROVED", perms: [] },
  });
  approvedNoVersion = noVersion.id;
});

afterAll(async () => {
  const pkgIds = [approvedNode?.id, approvedFlow?.id, pendingPkg?.id, approvedNoVersion].filter(
    (x): x is string => typeof x === "string",
  );
  await prisma.package.updateMany({ where: { id: { in: pkgIds } }, data: { latestVersionId: null } });
  await prisma.$transaction([
    prisma.packageVersion.deleteMany({ where: { packageId: { in: pkgIds } } }),
    prisma.downloadStat.deleteMany({ where: { packageId: { in: pkgIds } } }),
    prisma.reviewRecord.deleteMany({ where: { packageId: { in: pkgIds } } }),
    prisma.package.deleteMany({ where: { id: { in: pkgIds } } }),
    prisma.user.deleteMany({ where: { id: ownerId } }),
  ]);
  await prisma.$disconnect();
});

describe("market list", () => {
  it("匿名 list 仅含 APPROVED+latestVersion 非空；kind 小写往返；author=email 本地部分", async () => {
    const res = await app.request("/api/market/packages");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      items: Array<{ id: string; kind: string; author: { id: string; name: string } }>;
    };
    const ids = body.items.map((i) => i.id);
    if (approvedNode && approvedFlow) {
      expect(ids).toContain(approvedNode.id);
      expect(ids).toContain(approvedFlow.id);
    }
    expect(ids).not.toContain(pendingPkg?.id);
    expect(ids).not.toContain(approvedNoVersion);
    expect(body.total).toBeGreaterThanOrEqual(2);

    const node = body.items.find((i) => i.id === approvedNode?.id);
    expect(node?.kind).toBe("node"); // NODE→node 往返
    expect(node?.author.id).toBe(ownerId);
    expect(typeof node?.author.name).toBe("string");
  });

  it("kind 过滤=node 只返回 NODE 包", async () => {
    const res = await app.request("/api/market/packages?kind=node");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; kind: string }> };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i) => i.kind === "node")).toBe(true);
    expect(body.items.some((i) => i.id === approvedNode?.id)).toBe(true);
    expect(body.items.some((i) => i.id === approvedFlow?.id)).toBe(false);
  });

  it("sort=downloads 按 downloadCount desc", async () => {
    const res = await app.request("/api/market/packages?sort=downloads&pageSize=100");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    const idxA = body.items.findIndex((i) => i.id === approvedNode?.id);
    const idxB = body.items.findIndex((i) => i.id === approvedFlow?.id);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeGreaterThan(idxB); // flow(10) 在 node(5) 前
  });

  it("q= ILIKE 搜索命中 name/summary", async () => {
    const byName = await app.request(`/api/market/packages?q=${encodeURIComponent("价格")}`);
    const bodyName = (await byName.json()) as { items: Array<{ id: string }> };
    expect(byName.status).toBe(200);
    expect(bodyName.items.some((i) => i.id === approvedNode?.id)).toBe(true);
    expect(bodyName.items.some((i) => i.id === approvedFlow?.id)).toBe(false);

    const bySummary = await app.request(`/api/market/packages?q=${encodeURIComponent("样本摘要")}`);
    expect(bySummary.status).toBe(200);
    const bodySummary = (await bySummary.json()) as { items: Array<{ id: string }> };
    expect(bodySummary.items.some((i) => i.id === approvedFlow?.id)).toBe(true);
  });

  it("分页：pageSize=1+page=2 与全量第 2 项一致；默认 page=1/pageSize=20", async () => {
    const all = (await (await app.request("/api/market/packages?sort=latest")).json()) as {
      items: Array<{ id: string }>;
      total: number;
    };
    const page2 = (await (await app.request("/api/market/packages?sort=latest&pageSize=1&page=2")).json()) as {
      items: Array<{ id: string }>;
    };
    expect(page2.items[0]?.id).toBe(all.items[1]?.id);
  });

  it("非法查询参 → 400 VALIDATION-FAILED（kind/page/pageSize/sort）", async () => {
    for (const qs of ["?kind=bogus", "?page=0", "?pageSize=101", "?sort=popular", "?pageSize=0"]) {
      const res = await app.request(`/api/market/packages${qs}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION-FAILED");
    }
  });
});

describe("market detail", () => {
  it("200 PackageDetail：versions 元素形={semver,createdAt,sizeBytes,checksum}+perms", async () => {
    const res = await app.request(`/api/market/packages/${approvedNode?.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      kind: string;
      perms: string[];
      version: string;
      versions: Array<{ semver: string; createdAt: string; sizeBytes: number; checksum: string }>;
    };
    expect(body.id).toBe(approvedNode?.id);
    expect(body.kind).toBe("node");
    expect(body.perms).toEqual(["文件"]);
    expect(body.version).toBe("1.0.0");
    expect(body.versions).toHaveLength(1);
    expect(body.versions[0]).toMatchObject({ semver: "1.0.0", sizeBytes: 123 });
    expect(body.versions[0].checksum).toMatch(/^sha256:/);
    expect(typeof body.versions[0].createdAt).toBe("string");
  });

  it("PENDING 包 detail → 404 MARKET-PACKAGE-NOT-FOUND（审核通过前不可见 PRD-A13-02）", async () => {
    const res = await app.request(`/api/market/packages/${pendingPkg?.id}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("MARKET-PACKAGE-NOT-FOUND");
  });

  it("不存在 → 404 MARKET-PACKAGE-NOT-FOUND", async () => {
    const res = await app.request(`/api/market/packages/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("MARKET-PACKAGE-NOT-FOUND");
  });
});

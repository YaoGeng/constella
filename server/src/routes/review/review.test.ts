/**
 * T2-08 验收：review 状态机（TDD-S-03 §6.1a~e＋并发防护）。
 * a) PENDING approve → 200 {status:'approved'} + ReviewRecord 恰一行；
 * b) 并发双 decide 同包（Promise.all 真并发）→ 恰一 200 + 一 409 REVIEW-ALREADY-DONE；
 * c) reject 缺 reason → 400 VALIDATION-FAILED；
 * d) offline 非 APPROVED（PENDING 绕过）→ 409；
 * e) offline → status='offline' + ReviewRecord(action=OFFLINE, reason)。
 * 装配：/api/admin 子树鉴权归 T2-09——本套件以桩中间件注入 currentUser（装配语义等价）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Hono } from "hono";
import { withKernel } from "../../kernel/kernel.js";
import type { AppEnv } from "../../kernel/kernel.js";
import { prisma } from "../../utils/prisma.js";
import { reviewRoutes } from "./review.routes.js";
import { canTransition, REVIEW_TRANSITIONS } from "./state-machine.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const EMAIL_PREFIX = "vitest-review-";

/** 组件级装配：kernel（错误体渲染）＋currentUser 桩（T2-09 装配点注入 requireAdmin 的等价语义） */
let stubUser: Awaited<ReturnType<typeof prisma.user.create>> | undefined;
const app = new Hono<AppEnv>();
withKernel(app, {});
const stub = new Hono<AppEnv>();
stub.use("*", async (c, next) => {
  if (stubUser) c.set("currentUser", stubUser);
  await next();
});
stub.route("/", reviewRoutes);
app.route("/api/admin", stub);

let reviewerId = "";

const JSON_HEADERS = { "content-type": "application/json" };

function uniqueEmail(): string {
  return `${EMAIL_PREFIX}${randomUUID()}@test.local`;
}

async function createReviewer() {
  const user = await prisma.user.create({
    data: { email: uniqueEmail(), passwordHash: await bcrypt.hash("12345678", 10) },
  });
  return user;
}

async function createPendingPackage(): Promise<string> {
  const owner = await prisma.user.create({
    data: { email: uniqueEmail(), passwordHash: await bcrypt.hash("12345678", 10) },
  });
  const pkg = await prisma.package.create({
    data: { kind: "NODE", name: `审包-${randomUUID().slice(0, 8)}`, ownerUserId: owner.id, status: "PENDING", perms: [] },
  });
  const version = await prisma.packageVersion.create({
    data: {
      packageId: pkg.id,
      semver: "1.0.0",
      storageKey: `packages/${pkg.id}/1.0.0.zip`,
      checksum: `sha256:${randomUUID()}`,
      sizeBytes: 100,
      manifest: { kind: "node", name: "x", version: "1.0.0" },
    },
  });
  await prisma.package.update({ where: { id: pkg.id }, data: { latestVersionId: version.id } });
  return pkg.id;
}

async function decide(id: string, body: unknown): Promise<Response> {
  return app.request(`/api/admin/packages/${id}/review`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

async function offline(id: string, body: unknown): Promise<Response> {
  return app.request(`/api/admin/packages/${id}/offline`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

beforeAll(async () => {
  const reviewer = await createReviewer();
  reviewerId = reviewer.id;
  stubUser = reviewer;
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { startsWith: EMAIL_PREFIX } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const pkgs = await prisma.package.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
  const pkgIds = pkgs.map((p) => p.id);
  if (pkgIds.length > 0) {
    await prisma.package.updateMany({ where: { id: { in: pkgIds } }, data: { latestVersionId: null } });
    await prisma.$transaction([
      prisma.packageVersion.deleteMany({ where: { packageId: { in: pkgIds } } }),
      prisma.reviewRecord.deleteMany({ where: { packageId: { in: pkgIds } } }),
      prisma.downloadStat.deleteMany({ where: { packageId: { in: pkgIds } } }),
      prisma.package.deleteMany({ where: { id: { in: pkgIds } } }),
      prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    ]);
  }
  await prisma.$disconnect();
});

describe("review state machine（静态）", () => {
  it("迁移表=§1 图：PENDING→APPROVED/REJECTED、APPROVED→OFFLINE、REJECTED/OFFLINE 无出边", () => {
    expect(REVIEW_TRANSITIONS.PENDING).toEqual(["APPROVED", "REJECTED"]);
    expect(REVIEW_TRANSITIONS.APPROVED).toEqual(["OFFLINE"]);
    expect(REVIEW_TRANSITIONS.REJECTED).toEqual([]);
    expect(REVIEW_TRANSITIONS.OFFLINE).toEqual([]);
    expect(canTransition("PENDING", "APPROVED")).toBe(true);
    expect(canTransition("PENDING", "REJECTED")).toBe(true);
    expect(canTransition("APPROVED", "OFFLINE")).toBe(true);
    expect(canTransition("OFFLINE", "APPROVED")).toBe(false);
    expect(canTransition("REJECTED", "PENDING")).toBe(false); // 再发布回 PENDING 由 S-02 置位，非 review 动作
    expect(canTransition("PENDING", "OFFLINE")).toBe(false); // 防绕过审核
  });
});

describe("review decide", () => {
  it("a) PENDING approve → 200 {status:'approved'}＋ReviewRecord 恰一行", async () => {
    const id = await createPendingPackage();
    const res = await decide(id, { action: "approve" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("approved");

    const pkg = await prisma.package.findUnique({ where: { id }, select: { status: true } });
    expect(pkg?.status).toBe("APPROVED");
    const records = await prisma.reviewRecord.findMany({ where: { packageId: id } });
    expect(records).toHaveLength(1);
    expect(records[0]?.action).toBe("APPROVE");
    expect(records[0]?.reviewerId).toBe(reviewerId);
  });

  it("b) 并发双 decide 同包 → 恰一 200 + 一 409 REVIEW-ALREADY-DONE；留痕恰一行", async () => {
    const id = await createPendingPackage();
    const [r1, r2] = await Promise.all([
      decide(id, { action: "approve" }),
      decide(id, { action: "reject", reason: "并发驳回" }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = r1.status === 409 ? r1 : r2;
    expect(((await loser.json()) as { error: { code: string } }).error.code).toBe("REVIEW-ALREADY-DONE");

    const pkg = await prisma.package.findUnique({ where: { id }, select: { status: true } });
    expect(["APPROVED", "REJECTED"]).toContain(pkg?.status);
    const records = await prisma.reviewRecord.findMany({ where: { packageId: id } });
    expect(records).toHaveLength(1); // 恰一决策留痕
  });

  it("c) reject 缺 reason → 400 VALIDATION-FAILED", async () => {
    const id = await createPendingPackage();
    const res = await decide(id, { action: "reject" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION-FAILED");
    const pkg = await prisma.package.findUnique({ where: { id }, select: { status: true } });
    expect(pkg?.status).toBe("PENDING"); // 未迁移
    expect(await prisma.reviewRecord.count({ where: { packageId: id } })).toBe(0);
  });

  it("reject 带 reason → REJECTED＋留痕；重复 decide → 409", async () => {
    const id = await createPendingPackage();
    const res = await decide(id, { action: "reject", reason: "脚本含未声明的文件写权限" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("rejected");
    const record = await prisma.reviewRecord.findFirst({ where: { packageId: id } });
    expect(record?.action).toBe("REJECT");
    expect(record?.reason).toBe("脚本含未声明的文件写权限");

    const again = await decide(id, { action: "approve" });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("REVIEW-ALREADY-DONE");
  });

  it("非法 action/坏 JSON → 400 VALIDATION-FAILED；包不存在 → 404 NOT-FOUND", async () => {
    const id = await createPendingPackage();
    const badAction = await decide(id, { action: "offline" });
    expect(badAction.status).toBe(400);

    const badJson = await app.request(`/api/admin/packages/${id}/review`, { method: "POST", headers: JSON_HEADERS, body: "not-json{" });
    expect(badJson.status).toBe(400);

    const missing = await decide(randomUUID(), { action: "approve" });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("NOT-FOUND");
  });
});

describe("review offline", () => {
  it("d) 非 APPROVED（PENDING）→ 409 REVIEW-ALREADY-DONE（防绕过审核）", async () => {
    const id = await createPendingPackage();
    const res = await offline(id, { reason: "越线下架" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("REVIEW-ALREADY-DONE");
    expect(await prisma.reviewRecord.count({ where: { packageId: id } })).toBe(0);
  });

  it("e) APPROVED → 200 {status:'offline'}＋ReviewRecord(action=OFFLINE, reason)", async () => {
    const id = await createPendingPackage();
    await prisma.package.update({ where: { id }, data: { status: "APPROVED" } });
    const res = await offline(id, { reason: "违规内容" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("offline");

    const pkg = await prisma.package.findUnique({ where: { id }, select: { status: true } });
    expect(pkg?.status).toBe("OFFLINE");
    const records = await prisma.reviewRecord.findMany({ where: { packageId: id } });
    expect(records).toHaveLength(1);
    expect(records[0]?.action).toBe("OFFLINE");
    expect(records[0]?.reason).toBe("违规内容");
  });

  it("offline 缺 reason → 400；不存在 → 404；OFFLINE 终态再 offline → 409", async () => {
    const id = await createPendingPackage();
    await prisma.package.update({ where: { id }, data: { status: "APPROVED" } });
    const noReason = await offline(id, {});
    expect(noReason.status).toBe(400);

    const missing = await offline(randomUUID(), { reason: "x" });
    expect(missing.status).toBe(404);

    const res = await offline(id, { reason: "第一次下架" });
    expect(res.status).toBe(200);
    const again = await offline(id, { reason: "再次下架" });
    expect(again.status).toBe(409); // OFFLINE 无出边（V1 终态）
  });
});

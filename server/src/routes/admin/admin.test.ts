/**
 * T2-10 验收：RBAC＋用户管理（TDD-S-04 §6.1a/b/c/e）。
 * a) 无 token → 401、USER token → 403 FORBIDDEN；ADMIN → 200；
 * b) ban 后三路即时失效：目标用户 login → 401 ADMIN-USER-BANNED、既有 refresh → 401、Bearer 业务路由 → 401；
 * c) unban → login 200；
 * e) q= 模糊命中 email；packageCount=owner 包计数聚合。
 * 装配：adminRoutes 自挂 authMiddleware→requireAdmin（S-04 §3）；/api/admin 子树统一装配归 T2-09。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { buildApp } from "../../app.js";
import { prisma } from "../../utils/prisma.js";
import { adminRoutes } from "./admin.routes.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const app = buildApp(); // /api/auth /api/user /api/market（T2-05/06/07 已挂）
app.route("/api/admin", adminRoutes); // 本卡组件装配位（T2-09 换子树级统一挂载）

const EMAIL_PREFIX = "vitest-admin-";
const JSON_HEADERS = { "content-type": "application/json" };

function uniqueEmail(): string {
  return `${EMAIL_PREFIX}${randomUUID()}@test.local`;
}

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

async function createUser(role?: "ADMIN"): Promise<TestUser> {
  const email = uniqueEmail();
  await app.request("/api/auth/register", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email, password: "12345678" }) });
  if (role === "ADMIN") {
    await prisma.user.update({ where: { email }, data: { role: "ADMIN" } });
  }
  const login = (await (await app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email, password: "12345678" }) })).json()) as { accessToken: string; refreshToken: string; user: { id: string } };
  return { id: login.user.id, email, accessToken: login.accessToken, refreshToken: login.refreshToken };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let admin: TestUser;
let plainUser: TestUser;
let packageOwner: TestUser;
const createdPackageIds: string[] = [];

beforeAll(async () => {
  admin = await createUser("ADMIN");
  plainUser = await createUser();
  packageOwner = await createUser();
  for (let i = 0; i < 2; i++) {
    const pkg = await prisma.package.create({
      data: { kind: "PACK", name: `聚合包${i}`, ownerUserId: packageOwner.id, status: "PENDING", perms: [] },
    });
    createdPackageIds.push(pkg.id);
  }
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { startsWith: EMAIL_PREFIX } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const pkgIds = [
    ...createdPackageIds,
    ...(await prisma.package.findMany({ where: { ownerUserId: { in: userIds } } })).map((p) => p.id),
  ];
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
  await prisma.$disconnect();
});

describe("admin rbac", () => {
  it("a) 无 token → 401 UNAUTHORIZED", async () => {
    const res = await app.request("/api/admin/users");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("a) 坏 token → 401；USER token → 403 FORBIDDEN", async () => {
    const bad = await app.request("/api/admin/users", { headers: auth("not-a-jwt") });
    expect(bad.status).toBe(401);

    const res = await app.request("/api/admin/users", { headers: auth(plainUser.accessToken) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("ADMIN token → 200 {items,total}；行形={id,email,role,status,createdAt,packageCount}", async () => {
    const res = await app.request(`/api/admin/users?q=${encodeURIComponent(packageOwner.email)}`, { headers: auth(admin.accessToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; email: string; role: string; status: string; createdAt: string; packageCount: number }>;
      total: number;
    };
    expect(body.total).toBe(1);
    const row = body.items[0];
    expect(row?.id).toBe(packageOwner.id);
    expect(row?.email).toBe(packageOwner.email);
    expect(row?.role).toBe("user"); // 小写口径（X-01）
    expect(row?.status).toBe("active");
    expect(typeof row?.createdAt).toBe("string");
    expect(row?.packageCount).toBe(2); // e) owner 包计数聚合
  });

  it("e) q= 部分串模糊命中 email（ILIKE）", async () => {
    const fragment = packageOwner.email.slice(4, 20);
    const res = await app.request(`/api/admin/users?q=${encodeURIComponent(fragment)}`, { headers: auth(admin.accessToken) });
    const body = (await res.json()) as { items: Array<{ email: string }>; total: number };
    expect(body.items.some((i) => i.email === packageOwner.email)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("非法查询参 → 400 VALIDATION-FAILED", async () => {
    const res = await app.request("/api/admin/users?page=0", { headers: auth(admin.accessToken) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION-FAILED");
  });
});

describe("admin ban/unban", () => {
  it("b) ban：reason 必填（缺→400）；成功 → {ok}；三路即时失效", async () => {
    const target = await createUser();
    const noReason = await app.request(`/api/admin/users/${target.id}/ban`, { method: "POST", headers: auth(admin.accessToken), body: "{}" });
    expect(noReason.status).toBe(400);
    expect(((await noReason.json()) as { error: { code: string } }).error.code).toBe("VALIDATION-FAILED");

    const ban = await app.request(`/api/admin/users/${target.id}/ban`, {
      method: "POST",
      headers: auth(admin.accessToken),
      body: JSON.stringify({ reason: "发布恶意脚本" }),
    });
    expect(ban.status).toBe(200);
    expect(((await ban.json()) as { ok: boolean }).ok).toBe(true);

    // 三路：login / 既有 refresh / Bearer
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: target.email, password: "12345678" }),
    });
    expect(login.status).toBe(401);
    expect(((await login.json()) as { error: { code: string } }).error.code).toBe("ADMIN-USER-BANNED");

    const refresh = await app.request("/api/auth/refresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ refreshToken: target.refreshToken }),
    });
    expect(refresh.status).toBe(401);

    const profile = await app.request("/api/user/profile", { headers: auth(target.accessToken) });
    expect(profile.status).toBe(401);
    expect(((await profile.json()) as { error: { code: string } }).error.code).toBe("ADMIN-USER-BANNED");

    // c) unban → login 200
    const unban = await app.request(`/api/admin/users/${target.id}/unban`, { method: "POST", headers: auth(admin.accessToken), body: "{}" });
    expect(unban.status).toBe(200);
    expect(((await unban.json()) as { ok: boolean }).ok).toBe(true);
    const relogin = await app.request("/api/auth/login", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: target.email, password: "12345678" }),
    });
    expect(relogin.status).toBe(200);
  });

  it("ban 不存在用户 → 404 NOT-FOUND；unban 不存在 → 404", async () => {
    const ban = await app.request(`/api/admin/users/${randomUUID()}/ban`, {
      method: "POST", headers: auth(admin.accessToken), body: JSON.stringify({ reason: "x" }),
    });
    expect(ban.status).toBe(404);
    const unban = await app.request(`/api/admin/users/${randomUUID()}/unban`, { method: "POST", headers: auth(admin.accessToken), body: "{}" });
    expect(unban.status).toBe(404);
  });

  it("封禁管理员自身 → 其 token 即时失效（401）", async () => {
    const adminB = await createUser("ADMIN");
    await prisma.user.update({ where: { id: adminB.id }, data: { status: "BANNED" } });
    const res = await app.request("/api/admin/users", { headers: auth(adminB.accessToken) });
    expect(res.status).toBe(401);
  });

  it("USER 对他人 ban → 403 FORBIDDEN（RBAC 先于业务）", async () => {
    const res = await app.request(`/api/admin/users/${plainUser.id}/ban`, {
      method: "POST", headers: auth(plainUser.accessToken), body: JSON.stringify({ reason: "越权" }),
    });
    expect(res.status).toBe(403);
  });
});

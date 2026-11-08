/**
 * T2-10 验收：RBAC＋用户管理（TDD-S-04 §6.1a/b/c/e）；T2-11 增补：stats overview＋AdminSeed 幂等。
 * a) 无 token → 401、USER token → 403 FORBIDDEN；ADMIN → 200；
 * b) ban 后三路即时失效：目标用户 login → 401 ADMIN-USER-BANNED、既有 refresh → 401、Bearer 业务路由 → 401；
 * c) unban → login 200；
 * e) q= 模糊命中 email；packageCount=owner 包计数聚合。
 * T2-11 §6.1d：daily7d 恰 7 桶、历史空日补零、当日桶=当日 DownloadStat 数、五计数对齐；
 * §6.4：连续两次 seed → admin 用户恰一。
 * 装配（T2-09 起）：buildApp() 内 routes/index.ts 已在 /api/admin 子树统一挂
 * authMiddleware → requireAdmin 后挂 review/admin 两域——本套件走真实装配链。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../utils/prisma.js";
import { seedAdmin } from "./admin-seed.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const app = buildApp(); // /api/auth /api/user /api/market + /api/admin 子树（T2-09 统一守卫装配）

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

// ---- T2-11：stats 聚合（TDD-S-04 §6.1d）＋AdminSeed 幂等（§6.4）----

/** UTC 日起点（offset 天）；dayKey=YYYY-MM-DD */
function utcDayStart(offsetDays: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

describe("admin stats", () => {
  it("无 token → 401；USER token → 403 FORBIDDEN（stats 同 /api/admin 子树守卫）", async () => {
    const noToken = await app.request("/api/admin/stats/overview");
    expect(noToken.status).toBe(401);
    const userToken = await app.request("/api/admin/stats/overview", { headers: auth(plainUser.accessToken) });
    expect(userToken.status).toBe(403);
    expect(((await userToken.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("§6.1d overview 五计数与 prisma 直查对齐；daily7d 恰 7 桶且末日=今日（UTC）", async () => {
    // 并行套件共享同一 DB——五计数奇偶断言有界重试收敛（跨源读写窗口内写入会致单发假阴）
    interface OverviewBody {
      userCount: number; packageCount: number; pendingCount: number;
      downloadTotal: number; installTotal: number;
      daily7d: Array<{ date: string; downloads: number; installs: number }>;
    }
    let lastBody: OverviewBody | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await app.request("/api/admin/stats/overview", { headers: auth(admin.accessToken) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OverviewBody;
      lastBody = body;

      // 五计数对齐（API 与直查背靠背——计数器真值在 Package，02 §7.2）
      const [userCount, packageCount, pendingCount, sums] = await Promise.all([
        prisma.user.count(),
        prisma.package.count(),
        prisma.package.count({ where: { status: "PENDING" } }),
        prisma.package.aggregate({ _sum: { downloadCount: true, installCount: true } }),
      ]);
      const aligned =
        body.userCount === userCount &&
        body.packageCount === packageCount &&
        body.pendingCount === pendingCount &&
        body.downloadTotal === (sums._sum.downloadCount ?? 0) &&
        body.installTotal === (sums._sum.installCount ?? 0);
      if (aligned || attempt === 3) {
        expect(body.userCount).toBe(userCount);
        expect(body.packageCount).toBe(packageCount);
        expect(body.pendingCount).toBe(pendingCount);
        expect(body.downloadTotal).toBe(sums._sum.downloadCount ?? 0);
        expect(body.installTotal).toBe(sums._sum.installCount ?? 0);
        break;
      }
    }

    // 7 桶：升序、首=今日-6、末=今日（UTC）、键形 YYYY-MM-DD（确定性——与写入无关）
    expect(lastBody?.daily7d).toHaveLength(7);
    const expectedKeys: string[] = [];
    for (let i = 6; i >= 0; i--) expectedKeys.push(dayKey(utcDayStart(-i)));
    expect(lastBody?.daily7d.map((b) => b.date)).toEqual(expectedKeys);
  });

  it("§6.1d 历史空日补零（今日-6 零桶）；指定历史日桶=当日 DownloadStat 精确计数；当日桶=当日行数", async () => {
    // 独占包＋指定历史日（今日-5）行——其他并行套件只写 ts=now（今日），历史桶计数确定
    const pkg = await prisma.package.create({
      data: { kind: "PACK", name: `stats包-${randomUUID().slice(0, 8)}`, ownerUserId: packageOwner.id, status: "APPROVED", perms: [] },
    });
    createdPackageIds.push(pkg.id);
    const histDay = utcDayStart(-5);
    const histTs = new Date(histDay.getTime() + 12 * 3600 * 1000); // 当日正午（漂移安全）
    await prisma.$transaction([
      ...Array.from({ length: 3 }, () =>
        prisma.downloadStat.create({ data: { packageId: pkg.id, userId: packageOwner.id, type: "DOWNLOAD", ts: histTs } }),
      ),
      ...Array.from({ length: 2 }, () =>
        prisma.downloadStat.create({ data: { packageId: pkg.id, userId: packageOwner.id, type: "INSTALL", ts: histTs } }),
      ),
    ]);

    const res = await app.request("/api/admin/stats/overview", { headers: auth(admin.accessToken) });
    expect(res.status).toBe(200);
    const { daily7d } = (await res.json()) as {
      daily7d: Array<{ date: string; downloads: number; installs: number }>;
    };

    // 今日-6（无写入日）补零（确定性——并行套件只写 ts=now 当日行）
    const emptyBucket = daily7d.find((b) => b.date === dayKey(utcDayStart(-6)));
    expect(emptyBucket).toEqual({ date: dayKey(utcDayStart(-6)), downloads: 0, installs: 0 });

    // 今日-5 桶=精确 3/2（独占包独占日——确定）
    const histBucket = daily7d.find((b) => b.date === dayKey(histDay));
    expect(histBucket).toEqual({ date: dayKey(histDay), downloads: 3, installs: 2 });

    // 当日桶=当日 DownloadStat 数（并行套件当日写入——有界重试收敛跨源读写窗口）
    const todayStart = utcDayStart(0);
    let matched = false;
    let last: { downloads: number; installs: number } | undefined;
    for (let attempt = 1; attempt <= 3 && !matched; attempt++) {
      const res2 = await app.request("/api/admin/stats/overview", { headers: auth(admin.accessToken) });
      const body2 = (await res2.json()) as { daily7d: Array<{ date: string; downloads: number; installs: number }> };
      const todayBucket = body2.daily7d[body2.daily7d.length - 1];
      last = { downloads: todayBucket.downloads, installs: todayBucket.installs };
      const [todayDownloads, todayInstalls] = await Promise.all([
        prisma.downloadStat.count({ where: { type: "DOWNLOAD", ts: { gte: todayStart } } }),
        prisma.downloadStat.count({ where: { type: "INSTALL", ts: { gte: todayStart } } }),
      ]);
      expect(todayBucket.date).toBe(dayKey(todayStart));
      if (last.downloads === todayDownloads && last.installs === todayInstalls) {
        matched = true;
      } else if (attempt === 3) {
        expect(last.downloads).toBe(todayDownloads);
        expect(last.installs).toBe(todayInstalls);
      }
    }
    expect(matched).toBe(true);
  });
});

describe("admin seed（AdminSeed 幂等）", () => {
  it("§6.4 连续两次 seedAdmin → admin 用户恰一；首建 role=ADMIN", async () => {
    const email = uniqueEmail();
    const first = await seedAdmin({ email, password: "12345678" });
    const second = await seedAdmin({ email, password: "12345678" });
    expect(first).toBe("created");
    expect(second).toBe("skipped"); // 同 email 幂等跳过（不覆盖）

    const users = await prisma.user.findMany({ where: { email } });
    expect(users).toHaveLength(1); // 恰一
    expect(users[0]?.role).toBe("ADMIN");
    expect(users[0]?.status).toBe("ACTIVE");
  });

  it("同 email 已存在（USER）→ 跳过不覆盖角色/密码", async () => {
    const email = uniqueEmail();
    await seedAdmin({ email, password: "12345678" });
    // 第三方把该 email 降权为 USER 后再 seed——不回写 ADMIN
    await prisma.user.update({ where: { email }, data: { role: "USER" } });
    const again = await seedAdmin({ email, password: "another-password" });
    expect(again).toBe("skipped");
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.role).toBe("USER"); // 未被 seed 覆盖
  });
});

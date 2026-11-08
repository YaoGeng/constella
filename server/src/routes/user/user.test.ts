/**
 * T2-04 验收：GET /api/user/profile（requireActiveUser——不存在/BANNED → 401 封禁即时生效）。
 * 测试连隧道 DB；用户清理与本套件邮箱前缀绑定。
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../utils/prisma.js";

const app = buildApp();
const JSON_HEADERS = { "content-type": "application/json" };

function uniqueEmail(): string {
  return `vitest-user-${randomUUID()}@test.local`;
}

async function registerAndLogin(email: string): Promise<{ accessToken: string }> {
  await app.request("/api/auth/register", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password: "12345678" }),
  });
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password: "12345678" }),
  });
  return (await login.json()) as { accessToken: string };
}

function getProfile(accessToken?: string): Promise<Response> | Response {
  return app.request("/api/user/profile", {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "vitest-user-" } } });
  await prisma.$disconnect();
});

describe("user profile", () => {
  it("带有效 token → 200 {user:{id,email,role,isAuthor,createdAt}}", async () => {
    const email = uniqueEmail();
    const { accessToken } = await registerAndLogin(email);
    const res = await getProfile(accessToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; email: string; role: string; isAuthor: boolean; createdAt: string };
    };
    expect(body.user.id).toEqual(expect.any(String));
    expect(body.user.email).toBe(email);
    expect(body.user.role).toBe("user");
    expect(body.user.isAuthor).toBe(false);
    expect(typeof body.user.createdAt).toBe("string");
  });

  it("无 token → 401 UNAUTHORIZED 统一体", async () => {
    const res = await getProfile();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("坏 token → 401 UNAUTHORIZED", async () => {
    const res = await getProfile("not-a-jwt");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("封禁即时生效：登录后置 BANNED → 同一 accessToken → 401 ADMIN-USER-BANNED", async () => {
    const email = uniqueEmail();
    const { accessToken } = await registerAndLogin(email);
    await prisma.user.update({ where: { email }, data: { status: "BANNED" } });

    const res = await getProfile(accessToken);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ADMIN-USER-BANNED");
  });
});

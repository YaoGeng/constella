/**
 * T2-03 验收：`vitest run auth` 全绿（TDD-S-01 §6.1a~e；测试连隧道 DB，真并发用例）。
 * a) register 201 含 user.role 且无 accessToken；
 * b) 并发双 register 同邮箱 → 恰一 201 + 一 409 AUTH-EMAIL-TAKEN（C6）；
 * c) BANNED 用户 login → 401 ADMIN-USER-BANNED；
 * d) 并发双 refresh 同 token → 恰一 200 + 一 401（C4）；
 * e) 错误体={error:{code,message,requestId}} 且 requestId==X-Request-Id 头。
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../utils/prisma.js";

const app = buildApp(); // 测试实例：不挂限流规则（限流行为随 kernel 套件）

const JSON_HEADERS = { "content-type": "application/json" };

/** 本套件专属邮箱前缀，afterAll 统一清理（级联删 RefreshToken） */
function uniqueEmail(): string {
  return `vitest-auth-${randomUUID()}@test.local`;
}

async function registerUser(email: string, password = "12345678"): Promise<Response> {
  return app.request("/api/auth/register", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password }),
  });
}

async function loginUser(email: string, password = "12345678"): Promise<Response> {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password }),
  });
}

async function refreshToken(token: string): Promise<Response> {
  return app.request("/api/auth/refresh", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ refreshToken: token }),
  });
}

interface ErrorBodyShape {
  error: { code: string; message: string; requestId: string };
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "vitest-auth-" } } });
  await prisma.$disconnect();
});

describe("auth register", () => {
  it("a) 201 {user:{id,email,role}}，role 默认 user（X-01 小写口径），无令牌对（C1）", async () => {
    const email = uniqueEmail();
    const res = await registerUser(email);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { id: string; email: string; role: string } };
    expect(body.user).toEqual({ id: expect.any(String), email, role: "user" });
    expect("accessToken" in body).toBe(false);
    expect("refreshToken" in body).toBe(false);
  });

  it("b) 并发双 register 同邮箱 → 恰一 201 + 一 409 AUTH-EMAIL-TAKEN（C6）", async () => {
    const email = uniqueEmail();
    const [r1, r2] = await Promise.all([registerUser(email), registerUser(email)]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const conflict = r1.status === 409 ? r1 : r2;
    const body = (await conflict.json()) as ErrorBodyShape;
    expect(body.error.code).toBe("AUTH-EMAIL-TAKEN");
  });

  it("校验失败（密码 7 位/坏 JSON/缺字段）→ 400 VALIDATION-FAILED 统一体", async () => {
    const shortPassword = await app.request("/api/auth/register", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: uniqueEmail(), password: "1234567" }),
    });
    expect(shortPassword.status).toBe(400);
    expect(((await shortPassword.json()) as ErrorBodyShape).error.code).toBe("VALIDATION-FAILED");

    const badJson = await app.request("/api/auth/register", {
      method: "POST",
      headers: JSON_HEADERS,
      body: "not-json{",
    });
    expect(badJson.status).toBe(400);
    expect(((await badJson.json()) as ErrorBodyShape).error.code).toBe("VALIDATION-FAILED");
  });

  it("顺序重复 register → 409（C6 单发路径）", async () => {
    const email = uniqueEmail();
    const first = await registerUser(email);
    expect(first.status).toBe(201);
    const second = await registerUser(email);
    expect(second.status).toBe(409);
    expect(((await second.json()) as ErrorBodyShape).error.code).toBe("AUTH-EMAIL-TAKEN");
  });
});

describe("auth login", () => {
  it("200 {accessToken,refreshToken,user}（C1）", async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const res = await loginUser(email);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
      user: { id: string; email: string; role: string };
    };
    expect(typeof body.accessToken).toBe("string");
    expect(body.accessToken.split(".").length).toBe(3); // JWT 三段
    expect(typeof body.refreshToken).toBe("string");
    expect(body.user).toEqual({ id: expect.any(String), email, role: "user" });
  });

  it("密码错误 → 401 AUTH-INVALID-CREDENTIALS；e) requestId==X-Request-Id 头（§6.1e）", async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const res = await loginUser(email, "wrong-password-1");
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBodyShape;
    expect(body.error.code).toBe("AUTH-INVALID-CREDENTIALS");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("用户不存在 → 401 AUTH-INVALID-CREDENTIALS（不泄露邮箱存在性）", async () => {
    const res = await loginUser(uniqueEmail());
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBodyShape).error.code).toBe("AUTH-INVALID-CREDENTIALS");
  });

  it("c) BANNED 用户 login → 401 ADMIN-USER-BANNED", async () => {
    const email = uniqueEmail();
    await registerUser(email);
    await prisma.user.update({ where: { email }, data: { status: "BANNED" } });
    const res = await loginUser(email);
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBodyShape).error.code).toBe("ADMIN-USER-BANNED");
  });
});

describe("auth refresh", () => {
  it("轮换成功 → 200 新对 + user，旧 token 立即失效", async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const login = (await (await loginUser(email)).json()) as { refreshToken: string };

    const res = await refreshToken(login.refreshToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string; refreshToken: string; user: { email: string } };
    expect(body.refreshToken).not.toBe(login.refreshToken);
    expect(body.user.email).toBe(email);

    const replay = await refreshToken(login.refreshToken);
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as ErrorBodyShape).error.code).toBe("AUTH-REFRESH-INVALID");
  });

  it("d) 并发双 refresh 同 token → 恰一 200 + 一 401（C4）", async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const login = (await (await loginUser(email)).json()) as { refreshToken: string };

    const [r1, r2] = await Promise.all([refreshToken(login.refreshToken), refreshToken(login.refreshToken)]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 401]);

    const loser = r1.status === 401 ? r1 : r2;
    expect(((await loser.json()) as ErrorBodyShape).error.code).toBe("AUTH-REFRESH-INVALID");
  });

  it("伪造 token → 401 AUTH-REFRESH-INVALID", async () => {
    const res = await refreshToken("00000000-0000-0000-0000-000000000000-00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBodyShape).error.code).toBe("AUTH-REFRESH-INVALID");
  });

  it("BANNED 用户 refresh → 401（封禁即时生效）", async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const login = (await (await loginUser(email)).json()) as { refreshToken: string };
    await prisma.user.update({ where: { email }, data: { status: "BANNED" } });

    const res = await refreshToken(login.refreshToken);
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBodyShape).error.code).toBe("ADMIN-USER-BANNED");
  });
});

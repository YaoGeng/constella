/**
 * T2-01 验收：`vitest run auth -t "kernel"` 全绿（TDD-S-01 §6.1e/§6.2 内核部分）。
 * 覆盖：404 统一错误体、requestId==X-Request-Id 头、healthz、CORS（app:// + 预检头）、
 * 限流注册点（超限 429 RATE-LIMITED 统一体 + 窗口过期恢复）、未知异常 500 不外泄细节。
 * 说明：鉴权相关错误体的 requestId 断言随 T2-03 auth 域套件（login 401）补齐。
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const JSON_HEADERS = { "content-type": "application/json" };

describe("kernel", () => {
  it("healthz 200 {status:'ok'}（无鉴权、无 DB 依赖）", async () => {
    const app = buildApp();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("404 → 统一错误体 {error:{code,message,requestId}}，requestId==X-Request-Id 头（§6.1e）", async () => {
    const app = buildApp();
    const res = await app.request("/no-such-route");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe("NOT-FOUND");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
    expect(body.error.requestId).toMatch(/[0-9a-f-]{36}/);
  });

  it("成功响应亦携带 X-Request-Id 头", async () => {
    const app = buildApp();
    const res = await app.request("/healthz");
    expect(res.headers.get("x-request-id")).toMatch(/[0-9a-f-]{36}/);
  });

  it("未知异常 → 500 INTERNAL 统一体，不外泄异常细节", async () => {
    const app = buildApp();
    app.get("/__boom", () => {
      throw new Error("secret-detail");
    });
    const res = await app.request("/__boom");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("secret-detail");
  });

  it("CORS：默认放行 app://（回显 Access-Control-Allow-Origin），未列来源不回显", async () => {
    const app = buildApp();
    const allowed = await app.request("/healthz", { headers: { origin: "app://" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("app://");

    const denied = await app.request("/healthz", { headers: { origin: "http://evil.example" } });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("CORS 预检：放行 Authorization/Content-Type 请求头", async () => {
    const app = buildApp();
    const res = await app.request("/api/auth/login", {
      method: "OPTIONS",
      headers: {
        origin: "app://",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(res.status).toBeLessThan(400);
    const allowHeaders = res.headers.get("access-control-allow-headers") ?? "";
    expect(allowHeaders.toLowerCase()).toContain("authorization");
    expect(allowHeaders.toLowerCase()).toContain("content-type");
  });

  it("限流注册点：limit 3 → 第 4 次 429 RATE-LIMITED 统一体 + Retry-After；窗口过期后恢复", async () => {
    const windowMs = 120;
    const app = buildApp({ rateRules: [{ path: "/api/auth/register", limit: 3, windowMs }] });
    const post = () =>
      app.request("/api/auth/register", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ email: "not-an-email", password: "x" }), // 校验失败即 400，不触 bcrypt
      });

    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await post()).status);
    }
    const blocked = await post();
    statuses.push(blocked.status);
    expect(statuses).toEqual([400, 400, 400, 429]);

    const body = (await blocked.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("RATE-LIMITED");
    expect(body.error.requestId).toBe(blocked.headers.get("x-request-id"));
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);

    // 窗口过期后恢复放行
    await new Promise((resolve) => setTimeout(resolve, windowMs + 50));
    const recovered = await post();
    expect(recovered.status).toBe(400);
  });
});

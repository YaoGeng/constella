/**
 * OpenApiDoc（TDD-S-02 §3；T2-07）——GET /api/openapi.json。
 * 方案裁定：hono-openapi 未安装（server/package.json 无该依赖，hono 4.12 亦无内置 ./openapi 导出），
 * 且本批禁新增依赖 → 手写 OpenAPI JSON 路由（零新依赖）；zod schema 保持 plain zod（zod-openapi
 * 兼容写法），后续引入 hono-openapi 时可由 schema 直出替换本组件（组件级接口不变：聚合 /api 全路由）。
 * 覆盖面＝02 §6.2 client↔server + §6.3 admin↔server 全表（admin/review/stats 域已随 T2-09/11 装配，
 * 契约登记与路由实装对齐——OpenAPI 是契约聚合而非路由探测）。
 */
import { Hono } from "hono";
import type { AppEnv } from "../../kernel/kernel.js";

const jsonError = (codes: string[]) => ({
  description: "统一错误体 {error:{code,message,requestId}}（02 §6.1）",
  content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } },
  "x-error-codes": codes,
});

const errorBodySchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        requestId: { type: "string" },
      },
    },
  },
};

const marketListItemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    kind: { type: "string", enum: ["node", "pack", "flow"] },
    name: { type: "string" },
    summary: { type: "string" },
    author: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
    perms: { type: "array", items: { type: "string", enum: ["CDP", "网络", "文件", "AI", "交互", "社媒"] } },
    downloadCount: { type: "integer" },
    installCount: { type: "integer" },
    starCount: { type: "integer" },
    version: { type: "string" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const listQueryParams = [
  { name: "kind", in: "query", schema: { type: "string", enum: ["node", "pack", "flow"] } },
  { name: "q", in: "query", schema: { type: "string" }, description: "ILIKE 搜索（name/summary）" },
  { name: "sort", in: "query", schema: { type: "string", enum: ["latest", "downloads"] } },
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
];

const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
const bearerAuth = [{ bearerAuth: [] }];

/** 手写聚合文档（02 §6.2/§6.3 全端点） */
export const openApiDocument = {
  openapi: "3.1.0",
  info: { title: "Constella API", version: "0.1.0", description: "02 §6 API 契约聚合（/api 前缀）" },
  servers: [{ url: "/api" }],
  tags: [
    { name: "auth" }, { name: "user" }, { name: "market" }, { name: "admin-users" },
    { name: "review" }, { name: "stats" },
  ],
  paths: {
    "/auth/register": {
      post: {
        tags: ["auth"], summary: "注册（201 {user:{id,email,role}}）",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { email: { type: "string", format: "email" }, password: { type: "string", minLength: 8 } } } } } },
        responses: { 201: { description: "已注册" }, 400: jsonError(["VALIDATION-FAILED"]), 409: jsonError(["AUTH-EMAIL-TAKEN"]) },
      },
    },
    "/auth/login": {
      post: {
        tags: ["auth"], summary: "登录（{accessToken,refreshToken,user}）",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { email: { type: "string" }, password: { type: "string" } } } } } },
        responses: { 200: { description: "令牌对" }, 401: jsonError(["AUTH-INVALID-CREDENTIALS", "ADMIN-USER-BANNED"]) },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["auth"], summary: "刷新（一次性轮换）",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["refreshToken"], properties: { refreshToken: { type: "string" } } } } } },
        responses: { 200: { description: "新令牌对" }, 401: jsonError(["AUTH-REFRESH-INVALID", "ADMIN-USER-BANNED"]) },
      },
    },
    "/user/profile": {
      get: { tags: ["user"], summary: "当前用户资料", security: bearerAuth, responses: { 200: { description: "{user}" }, 401: jsonError(["UNAUTHORIZED", "ADMIN-USER-BANNED"]) } },
    },
    "/market/packages": {
      get: {
        tags: ["market"], summary: "广场列表（匿名浏览 D-1；过滤 APPROVED+latestVersion 非空）",
        parameters: listQueryParams,
        responses: {
          200: { description: "{items:MarketListItem[],total}", content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: marketListItemSchema }, total: { type: "integer" } } } } } },
          400: jsonError(["VALIDATION-FAILED"]),
        },
      },
      post: {
        tags: ["market"], summary: "发布上传（multipart zip+meta → 202 PublishAccepted；限流 6/min）",
        security: bearerAuth,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file", "meta"],
                properties: {
                  file: { type: "string", format: "binary", description: "zip（≤20MB，四件套）" },
                  meta: { type: "string", description: 'JSON 字符串 {kind,name≤24,summary≤40}' },
                },
              },
            },
          },
        },
        responses: {
          202: { description: "{packageId,status:'pending',perms,checksum}" },
          400: jsonError(["MARKET-FILE-INVALID", "VALIDATION-FAILED"]),
          401: jsonError(["UNAUTHORIZED", "ADMIN-USER-BANNED"]),
          409: jsonError(["CONFLICT"]),
          429: jsonError(["RATE-LIMITED"]),
        },
      },
    },
    "/market/packages/{id}": {
      get: {
        tags: ["market"], summary: "包详情（versions 元素形={semver,createdAt,sizeBytes,checksum}；非 APPROVED 404）",
        parameters: [idParam],
        responses: {
          200: { description: "PackageDetail", content: { "application/json": { schema: { allOf: [marketListItemSchema, { type: "object", properties: { versions: { type: "array", items: { type: "object", properties: { semver: { type: "string" }, createdAt: { type: "string", format: "date-time" }, sizeBytes: { type: "integer" }, checksum: { type: "string" } } } } } }] } } } },
          404: jsonError(["MARKET-PACKAGE-NOT-FOUND"]),
        },
      },
    },
    "/market/packages/{id}/download": {
      get: {
        tags: ["market"], summary: "下载（能力协商：s3→302 signedUrl / disk→流式 zip+Content-Disposition；发放前计量；限流 30/min）",
        security: bearerAuth, parameters: [idParam],
        responses: {
          200: { description: "zip 流（disk 模式，attachment）", content: { "application/zip": { schema: { type: "string", format: "binary" } } } },
          302: { description: "Location=signedUrl（S3 模式，T2-13 起）" },
          404: jsonError(["MARKET-PACKAGE-NOT-FOUND", "MARKET-PACKAGE-NOT-APPROVED"]),
          429: jsonError(["RATE-LIMITED"]),
        },
      },
    },
    "/market/packages/{id}/installs": {
      post: {
        tags: ["market"], summary: "安装计量（幂等键 userId+packageId+day；重复 {ok} 不计数）",
        security: bearerAuth, parameters: [idParam],
        requestBody: { required: false, content: { "application/json": { schema: { type: "object" } } } },
        responses: { 200: { description: "{ok:true}" }, 401: jsonError(["UNAUTHORIZED", "ADMIN-USER-BANNED"]), 404: jsonError(["NOT-FOUND"]) },
      },
    },
    "/market/mine": {
      get: {
        tags: ["market"], summary: "我的发布（全状态＋驳回理由可见 PRD-A13-02）",
        security: bearerAuth,
        responses: { 200: { description: "{items:(MarketListItem&{status,reviewReason?})[],total}" }, 401: jsonError(["UNAUTHORIZED", "ADMIN-USER-BANNED"]) },
      },
    },
    "/admin/users": {
      get: {
        tags: ["admin-users"], summary: "用户列表/搜索（email ILIKE + packageCount 聚合；T2-10）",
        security: bearerAuth,
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          200: { description: "{items:AdminUserRow[],total}" },
          401: jsonError(["UNAUTHORIZED", "ADMIN-USER-BANNED"]),
          403: jsonError(["FORBIDDEN"]),
        },
      },
    },
    "/admin/users/{id}/ban": {
      post: {
        tags: ["admin-users"], summary: "封禁（reason 必填；三路即时失效 login/refresh/Bearer；T2-10）",
        security: bearerAuth, parameters: [idParam],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reason"], properties: { reason: { type: "string", minLength: 1 } } } } } },
        responses: { 200: { description: "{ok:true}" }, 400: jsonError(["VALIDATION-FAILED"]), 401: jsonError(["UNAUTHORIZED", "ADMIN-USER-BANNED"]), 403: jsonError(["FORBIDDEN"]), 404: jsonError(["NOT-FOUND"]) },
      },
    },
    "/admin/users/{id}/unban": {
      post: {
        tags: ["admin-users"], summary: "解封（T2-10）",
        security: bearerAuth, parameters: [idParam],
        requestBody: { required: false, content: { "application/json": { schema: { type: "object" } } } },
        responses: { 200: { description: "{ok:true}" }, 401: jsonError(["UNAUTHORIZED", "ADMIN-USER-BANNED"]), 403: jsonError(["FORBIDDEN"]), 404: jsonError(["NOT-FOUND"]) },
      },
    },
    "/admin/reviews": {
      get: {
        tags: ["review"], summary: "待审队列分页（T2-09 装配）",
        security: bearerAuth,
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["pending", "approved", "rejected", "offline"] } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
        ],
        responses: { 200: { description: "{items:ReviewQueueItem[],total}" }, 401: jsonError(["UNAUTHORIZED"]), 403: jsonError(["FORBIDDEN"]) },
      },
    },
    "/admin/packages/{id}": {
      get: {
        tags: ["review"], summary: "工作台包详情聚合（manifest 摘要/脚本清单/计量；T2-09 装配）",
        security: bearerAuth, parameters: [idParam],
        responses: { 200: { description: "AdminPackageDetail" }, 401: jsonError(["UNAUTHORIZED"]), 403: jsonError(["FORBIDDEN"]), 404: jsonError(["NOT-FOUND"]) },
      },
    },
    "/admin/packages/{id}/download": {
      get: {
        tags: ["review"], summary: "下载预检流（经 S-05 getStream；Content-Disposition attachment；✅ M4 #9 增补行，T2-09 装配）",
        security: bearerAuth, parameters: [idParam],
        responses: {
          200: { description: "zip 流（attachment; filename=\"<semver>.zip\"）", content: { "application/zip": { schema: { type: "string", format: "binary" } } } },
          401: jsonError(["UNAUTHORIZED"]),
          403: jsonError(["FORBIDDEN"]),
          404: jsonError(["NOT-FOUND"]),
        },
      },
    },
    "/admin/packages/{id}/review": {
      post: {
        tags: ["review"], summary: "审核决策（approve|reject；reject 时 reason 必填；T2-08 状态机）",
        security: bearerAuth, parameters: [idParam],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["approve", "reject"] }, reason: { type: "string" } } } } } },
        responses: { 200: { description: "{status}" }, 400: jsonError(["VALIDATION-FAILED"]), 401: jsonError(["UNAUTHORIZED"]), 403: jsonError(["FORBIDDEN"]), 404: jsonError(["NOT-FOUND"]), 409: jsonError(["REVIEW-ALREADY-DONE"]) },
      },
    },
    "/admin/packages/{id}/offline": {
      post: {
        tags: ["review"], summary: "下架（条件 APPROVED；REVIEW {status:'offline'}；T2-08）",
        security: bearerAuth, parameters: [idParam],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reason"], properties: { reason: { type: "string" } } } } } },
        responses: { 200: { description: "{status:'offline'}" }, 401: jsonError(["UNAUTHORIZED"]), 403: jsonError(["FORBIDDEN"]), 404: jsonError(["NOT-FOUND"]), 409: jsonError(["REVIEW-ALREADY-DONE"]) },
      },
    },
    "/admin/stats/overview": {
      get: {
        tags: ["stats"], summary: "运营看板（overview 五计数+daily7d；T2-11）",
        security: bearerAuth,
        responses: { 200: { description: "{userCount,packageCount,pendingCount,downloadTotal,installTotal,daily7d}" }, 401: jsonError(["UNAUTHORIZED"]), 403: jsonError(["FORBIDDEN"]) },
      },
    },
  },
  components: {
    schemas: { ErrorBody: errorBodySchema },
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
  },
} as const;

/** OpenAPI 文档路由（挂载于 /api → GET /api/openapi.json） */
const openApiRoutes = new Hono<AppEnv>();
openApiRoutes.get("/openapi.json", (c) => c.json(openApiDocument, 200));

export { openApiRoutes };

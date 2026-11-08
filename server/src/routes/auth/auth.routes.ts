/**
 * auth 域路由（TDD-S-01 §1 端点表；T2-03：C1/C2/C6 落点）。
 * register → 201 {user:{id,email,role}}（不含令牌对；C1）；
 * login → 200 {accessToken,refreshToken,user}（BANNED → 401 ADMIN-USER-BANNED）；
 * refresh → 200 新对（一次性轮换；TokenService.rotate 含 C4 并发防护）。
 * 统一错误体由 kernel onError 渲染（C2）；错误经 ApiError 抛出。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import bcrypt from "bcryptjs";
import type { ZodType } from "zod";
import type { AppEnv } from "../../kernel/kernel.js";
import { ApiError } from "../../kernel/errors.js";
import { toUserProfile } from "../../kernel/user.js";
import { prisma } from "../../utils/prisma.js";
import { loginSchema, refreshSchema, registerSchema } from "./auth.schemas.js";
import { DUMMY_COMPARE_HASH, isUniqueViolation, issueTokenPair, rotate } from "./token.service.js";

/** 解析请求体：非法 JSON 一律按校验失败处理（VALIDATION-FAILED） */
async function parseBody<T>(schema: ZodType<T>, c: Context<AppEnv>): Promise<T> {
  const json: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError("VALIDATION-FAILED");
  }
  return parsed.data;
}

/** 注册：校验 → bcrypt(10) → create（C6：catch P2002 → 409 AUTH-EMAIL-TAKEN；role/status 走 DB 默认） */
const registerHandler = async (c: Context<AppEnv>) => {
  const body = await parseBody(registerSchema, c);
  const passwordHash = await bcrypt.hash(body.password, 10);
  let user;
  try {
    user = await prisma.user.create({ data: { email: body.email, passwordHash } });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError("AUTH-EMAIL-TAKEN");
    }
    throw err;
  }
  return c.json({ user: toUserProfile(user) }, 201);
};

/** 登录：校验 → 查用户（缺失走 dummy compare 防时序探测）→ 密码比对 → BANNED 检查 → 签发令牌对 */
const loginHandler = async (c: Context<AppEnv>) => {
  const body = await parseBody(loginSchema, c);
  const user = await prisma.user.findUnique({ where: { email: body.email } });

  if (!user) {
    await bcrypt.compare(body.password, DUMMY_COMPARE_HASH);
    throw new ApiError("AUTH-INVALID-CREDENTIALS");
  }

  const valid = await bcrypt.compare(body.password, user.passwordHash);
  if (!valid) {
    throw new ApiError("AUTH-INVALID-CREDENTIALS");
  }

  if (user.status === "BANNED") {
    throw new ApiError("ADMIN-USER-BANNED");
  }

  const pair = await issueTokenPair(user);
  return c.json({ ...pair, user: toUserProfile(user) }, 200);
};

/** 刷新：一次性轮换（并发防护在 TokenService.rotate——deleteMany 抢占 + insert P2002 兜底） */
const refreshHandler = async (c: Context<AppEnv>) => {
  const body = await parseBody(refreshSchema, c);
  const result = await rotate(body.refreshToken);
  if (!result.ok) {
    throw new ApiError(result.code);
  }
  return c.json({ ...result.pair, user: toUserProfile(result.user) }, 200);
};

/** 公开认证路由：/register、/login、/refresh（鉴权需求随 S-02+ 域在 kernel 扩展） */
const authRoutes = new Hono<AppEnv>();
authRoutes.post("/register", registerHandler);
authRoutes.post("/login", loginHandler);
authRoutes.post("/refresh", refreshHandler);

export { authRoutes };

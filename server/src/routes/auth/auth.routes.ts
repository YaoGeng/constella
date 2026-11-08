import { Hono } from "hono";
import type { Context } from "hono";
import { sign } from "hono/utils/jwt/jwt";
import bcrypt from "bcryptjs";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../utils/prisma.js";
import { env } from "../../utils/env.js";
import { registerSchema, loginSchema, refreshSchema } from "./auth.schemas.js";
/** RefreshToken 有效期：7 天（毫秒） */
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** 生成 Access Token（JWT），有效期 15 分钟 */
async function generateAccessToken(user: { id: string; email: string }): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 15 * 60;
  return sign({ sub: user.id, email: user.email, exp }, env.JWT_SECRET);
}

/** 生成原始 Refresh Token（UUID 拼接，明文返回客户端） */
function generateRefreshTokenString(): string {
  return randomUUID() + "-" + randomUUID();
}

/** 将 Refresh Token SHA256 哈希后存入数据库（原始令牌永不被持久化） */
function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 注册处理器：校验入参 → 检查邮箱重复 → bcrypt 哈希 → 创建用户 → 签发令牌对 */
const registerHandler = async (c: Context) => {
  const parseResult = registerSchema.safeParse(await c.req.json());
  if (!parseResult.success) {
    return c.json({ error: "Invalid input" }, 400);
  }

  const body = parseResult.data;

  // 邮箱唯一性检查
  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) {
    return c.json({ error: "Email already registered" }, 409);
  }

  // bcrypt 加盐哈希，成本因子 10
  const passwordHash = await bcrypt.hash(body.password, 10);
  const user = await prisma.user.create({
    data: { email: body.email, passwordHash },
  });

  // 签发令牌对
  const accessToken = await generateAccessToken(user);
  const refreshToken = generateRefreshTokenString();
  const tokenHash = hashRefreshToken(refreshToken);

  // 存储哈希后的 RefreshToken（原始令牌仅返回客户端，服务端不可逆）
  await prisma.refreshToken.create({
    data: {
      tokenHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    },
  });

  return c.json({ accessToken, refreshToken }, 201);
};

/** 登录处理器：校验入参 → 查找用户 → 防时序攻击的 dummy 哈希 → 密码比对 → 签发令牌对 */
const loginHandler = async (c: Context) => {
  const parseResult = loginSchema.safeParse(await c.req.json());
  if (!parseResult.success) {
    return c.json({ error: "Invalid input" }, 400);
  }

  const body = parseResult.data;
  const user = await prisma.user.findUnique({ where: { email: body.email } });

  // 用户不存在时执行 dummy bcrypt compare，防止通过响应时间推断邮箱是否存在
  if (!user) {
    await bcrypt.compare(body.password, "$2a$10$dummyHashForTiming");
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // 比对密码哈希
  const valid = await bcrypt.compare(body.password, user.passwordHash);
  if (!valid) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // 签发令牌对
  const accessToken = await generateAccessToken(user);
  const refreshToken = generateRefreshTokenString();
  const tokenHash = hashRefreshToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      tokenHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    },
  });

  return c.json({ accessToken, refreshToken }, 200);
};

/** Refresh 处理器：校验入参 → SHA256 查找 → 删除旧令牌 → 颁发新令牌对（令牌轮换） */
const refreshHandler = async (c: Context) => {
  const parseResult = refreshSchema.safeParse(await c.req.json());
  if (!parseResult.success) {
    return c.json({ error: "Invalid input" }, 400);
  }

  const body = parseResult.data;
  // 将客户端传来的 Refresh Token 哈希后查库
  const tokenHash = hashRefreshToken(body.refreshToken);

  const storedToken = await prisma.refreshToken.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
  });

  if (!storedToken) {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }

  // 删除旧令牌（单次使用，轮换后立即失效）
  await prisma.refreshToken.delete({ where: { id: storedToken.id } });

  const user = await prisma.user.findUnique({ where: { id: storedToken.userId } });
  if (!user) {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }

  // 颁发新的令牌对
  const accessToken = await generateAccessToken(user);
  const refreshToken = generateRefreshTokenString();
  const newTokenHash = hashRefreshToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      tokenHash: newTokenHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    },
  });

  return c.json({ accessToken, refreshToken }, 200);
};

/** 公开认证路由：/register、/login、/refresh */
const authRoutes = new Hono();
authRoutes.post("/register", registerHandler);
authRoutes.post("/login", loginHandler);
authRoutes.post("/refresh", refreshHandler);

export { authRoutes };

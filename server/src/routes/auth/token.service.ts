/**
 * TokenService（TDD-S-01 §3；T2-03）：令牌签发与一次性轮换。
 * Access：JWT HS256 15min（模板语义保留；C7——sign 取自 hono/jwt 公共入口）。
 * Refresh：随机 UUID 对、SHA256 落库（原始令牌仅存客户端）、7 天有效、一次性轮换；
 * C4 并发防护：deleteMany 原子抢占（count=0＝已被并发消费）→ 新 token insert catch P2002；胜者全得。
 */
import { createHash, randomUUID } from "node:crypto";
import { sign } from "hono/jwt";
import { Prisma } from "../../../generated/prisma/client.js";
import type { User } from "../../../generated/prisma/client.js";
import { env } from "../../utils/env.js";
import { prisma } from "../../utils/prisma.js";

/** Access Token 有效期：15 分钟（02 §5.1 模板语义） */
const ACCESS_TOKEN_TTL_SEC = 15 * 60;
/** Refresh Token 有效期：7 天（毫秒） */
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
/** 登录防时序探测 dummy 哈希（模板语义保留；无效输入也走一次 bcrypt compare） */
export const DUMMY_COMPARE_HASH = "$2a$10$dummyHashForTiming";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export type RotateFailureCode = "AUTH-REFRESH-INVALID" | "ADMIN-USER-BANNED";

export type RotateResult =
  | { ok: true; pair: TokenPair; user: User }
  | { ok: false; code: RotateFailureCode };

/** 生成 Access Token（JWT HS256，sub=userId） */
async function generateAccessToken(user: Pick<User, "id" | "email">): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SEC;
  return sign({ sub: user.id, email: user.email, exp }, env.JWT_SECRET, "HS256");
}

/** 生成原始 Refresh Token（UUID 拼接，明文仅返回客户端） */
function generateRefreshTokenString(): string {
  return randomUUID() + "-" + randomUUID();
}

/** Refresh Token SHA256 哈希（服务端只落哈希） */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 落库新 refresh token 行，返回明文令牌 */
async function createRefreshTokenRow(userId: string): Promise<string> {
  const refreshToken = generateRefreshTokenString();
  await prisma.refreshToken.create({
    data: {
      tokenHash: hashRefreshToken(refreshToken),
      userId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    },
  });
  return refreshToken;
}

/** 签发令牌对（login/refresh 用；register 不再签发——C1 自动登录由 client 串 /auth/login） */
export async function issueTokenPair(user: Pick<User, "id" | "email">): Promise<TokenPair> {
  const accessToken = await generateAccessToken(user);
  const refreshToken = await createRefreshTokenRow(user.id);
  return { accessToken, refreshToken };
}

/** Prisma 唯一约束冲突（P2002）判定 */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * 一次性轮换：SHA256 查库 → deleteMany 原子抢占（并发同 token 恰一胜者）→
 * 用户不存在/未抢到 → AUTH-REFRESH-INVALID；BANNED → ADMIN-USER-BANNED；
 * 新 token 落库撞唯一约束（tokenHash @unique，C4）→ AUTH-REFRESH-INVALID；胜者全得。
 */
export async function rotate(refreshToken: string): Promise<RotateResult> {
  const tokenHash = hashRefreshToken(refreshToken);
  const stored = await prisma.refreshToken.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
  });
  if (!stored) {
    return { ok: false, code: "AUTH-REFRESH-INVALID" };
  }

  // 原子抢占：count=0 说明已被并发请求消费
  const deleted = await prisma.refreshToken.deleteMany({ where: { id: stored.id } });
  if (deleted.count === 0) {
    return { ok: false, code: "AUTH-REFRESH-INVALID" };
  }

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user) {
    return { ok: false, code: "AUTH-REFRESH-INVALID" };
  }
  if (user.status === "BANNED") {
    return { ok: false, code: "ADMIN-USER-BANNED" };
  }

  try {
    const pair = await issueTokenPair(user);
    return { ok: true, pair, user };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, code: "AUTH-REFRESH-INVALID" };
    }
    throw err;
  }
}

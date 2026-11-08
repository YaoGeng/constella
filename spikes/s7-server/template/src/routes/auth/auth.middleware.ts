/**
 * JWT 认证中间件。
 * 自动从 Authorization: Bearer <token> 头中提取并验证 JWT，
 * 验证通过后将解码后的 payload 附加到 c.get('jwtPayload')。
 * 使用 HS256 对称签名，secret 由环境变量注入。
 */
import { jwt } from "hono/jwt";
import { env } from "../../utils/env.js";

// jwt() 返回 Hono 中间件，验证失败自动返回 401
export const authMiddleware = jwt({
  secret: env.JWT_SECRET,
  alg: "HS256",
});

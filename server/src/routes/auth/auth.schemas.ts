/**
 * 认证模块请求体校验 Schema（Zod v4）。
 * 注册时密码至少 8 位；登录与刷新 token 只需非空即可，
 * 更细粒度的校验已在业务层完成。
 * 注意：z.email() 仅在 Zod v4 中可用，v3 请改用 z.string().email()。
 */
import { z } from "zod";

// 注册：邮箱格式 + 密码 ≥ 8 位
export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

// 登录：邮箱格式 + 密码非空（与注册共用格式，最小长度放宽）

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

// 刷新 token：仅校验 refreshToken 字符串非空

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// 推导出的类型，供 handler / middleware 使用

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;

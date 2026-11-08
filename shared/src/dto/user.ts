// user 域 DTO（X-01 §1 dto 行；02 §6.2 GET /user/profile）。
// 枚举序列化口径：02 §6.4 示例中 status 一律小写字面量（'pending'/'rejected'/'offline'），
// role/userStatus 02 未给 JSON 示例——本包统一取小写字面量（Prisma 侧 USER/ADMIN/ACTIVE/BANNED
// 由 server 序列化层映射；发现 02 后续版本另有口径时以 02 为准回改本形）。
export type UserRole = 'user' | 'admin';

export type UserStatus = 'active' | 'banned';

/** 用户档案（02 §6.2 register 响应 {user:{id,email,role}} / GET /user/profile → {user}） */
export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
}

/** GET /user/profile → {user}（02 §6.2） */
export interface ProfileRes {
  user: UserProfile;
}

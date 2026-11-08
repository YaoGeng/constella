// auth 域 DTO（X-01 §1 dto 行；02 §6.2 auth 三接口；模板语义 02 §5.1：
// JWT HS256 Access 15 分钟；Refresh Token 随机 UUID、SHA256 落库、一次性轮换）。
import type { UserProfile } from './user';

/** POST /auth/register：{email,password}（02 §6.2；错误码 AUTH-EMAIL-TAKEN/VALIDATION-FAILED） */
export interface RegisterReq {
  email: string;
  password: string;
}

/** POST /auth/register → 201 {user:{id,email,role}}（02 §6.2） */
export interface RegisterRes {
  user: UserProfile;
}

/** POST /auth/login：{email,password}（02 §6.2；错误码 AUTH-INVALID-CREDENTIALS/ADMIN-USER-BANNED） */
export interface LoginReq {
  email: string;
  password: string;
}

/** POST /auth/login → {accessToken,refreshToken,user}（02 §6.2） */
export interface LoginRes {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
}

/** POST /auth/refresh：{refreshToken}（旧 token 一次性失效；错误码 AUTH-REFRESH-INVALID） */
export interface RefreshReq {
  refreshToken: string;
}

/** POST /auth/refresh → 新对（结构同 LoginRes，02 §6.2「→ 新对」） */
export type RefreshRes = LoginRes;

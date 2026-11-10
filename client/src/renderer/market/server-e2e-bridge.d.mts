// E2E server 桥类型面（T5-11 §6.8）——server 域类型不进 client tsc program 的最小结构型。
import type { IncomingMessage, ServerResponse } from 'node:http';

/** hono app 最小消费面（fetch 适配） */
export interface HonoAppLike {
  fetch(req: Request): Promise<Response> | Response;
}

/** prisma 消费面（E2E 直改库断言——T2-09 手法） */
export interface PrismaLike {
  user: {
    findMany(args: { where: { email: { startsWith: string } }; select: { id: true } }): Promise<Array<{ id: string }>>;
    deleteMany(args: { where: { id: { in: string[] } } }): Promise<unknown>;
  };
  package: {
    findMany(args: { where: { ownerUserId: { in: string[] } }; select: { id: true } }): Promise<Array<{ id: string }>>;
    findUniqueOrThrow(args: unknown): Promise<Record<string, unknown>>;
    update(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  packageVersion: { findMany(args: unknown): Promise<Array<{ storageKey: string }>>; deleteMany(args: unknown): Promise<unknown> };
  reviewRecord: { deleteMany(args: unknown): Promise<unknown> };
  downloadStat: { deleteMany(args: unknown): Promise<unknown> };
  $transaction(args: unknown): Promise<unknown>;
  $disconnect(): Promise<void>;
}

/** 磁盘对象存储最小消费面（清扫） */
export interface StorageLike {
  delete(key: string): Promise<unknown>;
}

export declare function loadAppModule(): Promise<{ buildApp: () => HonoAppLike }>;
export declare function loadPrisma(): Promise<{ prisma: PrismaLike }>;
export declare function loadStorageFactory(): Promise<{ getStorage: () => StorageLike }>;
// （未用——node:http 适配器本地实现；占位防 noUnusedLocals 误报已由 import type 消除）
export type HttpAdapterShapes = { req: IncomingMessage; res: ServerResponse };

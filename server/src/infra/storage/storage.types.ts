/**
 * StorageAdapter 接口与错误类型（TDD-S-05 §1 接口冻结；T2-12）。
 * 对象键规范：packages/<packageId>/<semver>.zip（02 §5.3）。
 * 只预签名 GET；PUT/DELETE 一律经 server 中转（S-05 预签名策略①）。
 */
import type { Readable } from "node:stream";

/** 对象元数据（随对象落 S3 metadata / disk 同名 .meta.json；checksum 由调用方传入） */
export interface StorageMeta {
  contentType: "application/zip";
  checksum: string;
}

export interface StoragePutResult {
  key: string;
  sizeBytes: number;
}

export interface SignedUrlOptions {
  /** TTL 设计值 300s（S-05 预签名策略①） */
  expiresInSec?: number;
}

export interface StorageAdapter {
  /** 上传对象（server 中转写；Buffer 或流式） */
  put(key: string, body: Buffer | Readable, meta: StorageMeta): Promise<StoragePutResult>;
  /** 仅 GET 下载预签名；driver 不支持时抛 StoragePresignUnsupported（能力声明非静默降级） */
  signedUrl(key: string, opts?: SignedUrlOptions): Promise<string>;
  /** 流式读取；对象不存在抛 StorageNotFound */
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

/** 预签名能力缺失：disk 实现不支持签名 URL（S-05 预签名策略④——下载走 getStream 流式发放） */
export class StoragePresignUnsupported extends Error {
  constructor(key: string) {
    super(`signedUrl is not supported by this storage driver (key=${key}); use getStream instead`);
    this.name = "StoragePresignUnsupported";
  }
}

/** 对象不存在 */
export class StorageNotFound extends Error {
  constructor(key: string) {
    super(`storage object not found (key=${key})`);
    this.name = "StorageNotFound";
  }
}

/** 对象键非法（含路径穿越片段/绝对路径/反斜杠——防御式校验，键虽由 server 生成） */
export class StorageKeyInvalid extends Error {
  constructor(key: string) {
    super(`invalid storage key: ${JSON.stringify(key)}`);
    this.name = "StorageKeyInvalid";
  }
}

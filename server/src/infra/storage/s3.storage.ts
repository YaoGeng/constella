/**
 * S3Storage：S3/MinIO 兼容实现（TDD-S-05 §3 s3 行；T2-13）。
 * @aws-sdk/client-s3＋s3-request-presigner @3.1164.0（T0-03 决策冻结——P-3 收窄：server 内唯一 @aws-sdk import 处）。
 * put=PutObjectCommand（server 中转写，流式入参先缓冲——业务层 zip ≤20MB 已限）；signedUrl=GetObjectCommand
 * presign（仅 GET，TTL 300s 设计值——预签名策略①）；getStream=GetObjectCommand 流式读；delete 幂等（S3 语义）。
 * MinIO/同类（COS/R2）：endpoint＋forcePathStyle=true（T0-03 取证注记）；对象元数据=checksum/contentType。
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import { assertValidStorageKey, StorageNotFound } from "./storage.types.js";
import type {
  SignedUrlOptions,
  StorageAdapter,
  StorageMeta,
  StoragePutResult,
} from "./storage.types.js";

export interface S3StorageOptions {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** 自定义 endpoint（MinIO/COS/R2 等 S3 兼容面；AWS 原生留空） */
  endpoint?: string;
  /** 路径风格寻址（自建 endpoint 默认 true——MinIO 取证注记；AWS 原生 false） */
  forcePathStyle?: boolean;
}

/** 流式入参先缓冲（PutObjectCommand 需确定长度；业务面 zip ≤20MB——02 §12.2#4 上游已限） */
async function streamToBuffer(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class S3Storage implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.forcePathStyle !== undefined ? { forcePathStyle: options.forcePathStyle } : {}),
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer | Readable, meta: StorageMeta): Promise<StoragePutResult> {
    assertValidStorageKey(key);
    const buffer = Buffer.isBuffer(body) ? body : await streamToBuffer(body);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: meta.contentType,
        Metadata: { checksum: meta.checksum },
      }),
    );
    return { key, sizeBytes: buffer.length };
  }

  async signedUrl(key: string, opts?: SignedUrlOptions): Promise<string> {
    assertValidStorageKey(key);
    // 仅 GET 预签名（策略①：PUT/DELETE 一律 server 中转，client 不持对象存储凭据）
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: opts?.expiresInSec ?? 300 },
    );
  }

  async getStream(key: string): Promise<Readable> {
    assertValidStorageKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      // Node 运行时下 SDK 返回 Readable（类型联合含 web 流/Blob——按运行时断言收窄）
      return res.Body as Readable;
    } catch (err) {
      if (
        err instanceof S3ServiceException &&
        (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404)
      ) {
        throw new StorageNotFound(key);
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    assertValidStorageKey(key);
    // S3 delete 对不存在对象幂等成功（与 disk 实现语义对齐）
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

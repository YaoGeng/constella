/**
 * DiskStorage：本地磁盘实现（TDD-S-05 §3；T2-12）。
 * 对象落 STORAGE_DIR/<key>，同伴元数据落 <key>.meta.json（同目录同名）。
 * 零新依赖（node:fs）；signedUrl 抛 StoragePresignUnsupported＝能力声明而非静默降级。
 */
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  StorageKeyInvalid,
  StorageNotFound,
  StoragePresignUnsupported,
} from "./storage.types.js";
import type {
  SignedUrlOptions,
  StorageAdapter,
  StorageMeta,
  StoragePutResult,
} from "./storage.types.js";

/** .meta.json 落盘形（StorageMeta + 服务端补充的客观事实字段） */
interface MetaFile extends StorageMeta {
  sizeBytes: number;
  updatedAt: string;
}

/** 字节计数 Transform（流式写入时统计 sizeBytes） */
function counterTransform(onCount: (n: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, callback) {
      onCount(chunk.length);
      callback(null, chunk);
    },
  });
}

export class DiskStorage implements StorageAdapter {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  /** 键解析 + 防穿越：拒绝空段/`.`/`..`/反斜杠/绝对键，并二次校验解析结果仍根植于 rootDir */
  private resolveObjectPath(key: string): string {
    if (typeof key !== "string" || key.length === 0 || key.includes("\\")) {
      throw new StorageKeyInvalid(key);
    }
    const segments = key.split("/");
    if (segments.some((s) => s === "" || s === "." || s === "..")) {
      throw new StorageKeyInvalid(key);
    }
    const objectPath = path.resolve(this.rootDir, ...segments);
    if (objectPath !== this.rootDir && !objectPath.startsWith(this.rootDir + path.sep)) {
      throw new StorageKeyInvalid(key);
    }
    return objectPath;
  }

  private metaPathOf(objectPath: string): string {
    return `${objectPath}.meta.json`;
  }

  async put(key: string, body: Buffer | Readable, meta: StorageMeta): Promise<StoragePutResult> {
    const objectPath = this.resolveObjectPath(key);
    await fs.mkdir(path.dirname(objectPath), { recursive: true });

    let sizeBytes = 0;
    if (Buffer.isBuffer(body)) {
      sizeBytes = body.length;
      await fs.writeFile(objectPath, body);
    } else {
      const countChunk = (n: number) => {
        sizeBytes += n;
      };
      await pipeline(body, counterTransform(countChunk), createWriteStream(objectPath));
    }

    const metaFile: MetaFile = {
      contentType: meta.contentType,
      checksum: meta.checksum,
      sizeBytes,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(this.metaPathOf(objectPath), JSON.stringify(metaFile, null, 2), "utf8");

    return { key, sizeBytes };
  }

  async signedUrl(key: string, opts?: SignedUrlOptions): Promise<string> {
    void opts; // 签名参数对 disk 无意义——本实现恒不支持预签名
    // 能力声明非静默降级（S-05 预签名策略④）：disk 下载路径走 getStream 流式（策略②）
    throw new StoragePresignUnsupported(key);
  }

  async getStream(key: string): Promise<Readable> {
    const objectPath = this.resolveObjectPath(key);
    try {
      await fs.access(objectPath);
    } catch {
      throw new StorageNotFound(key);
    }
    return createReadStream(objectPath);
  }

  async delete(key: string): Promise<void> {
    const objectPath = this.resolveObjectPath(key);
    // 幂等：对象与 .meta.json 缺失时静默成功（对齐 S3 delete 语义）
    await fs.rm(objectPath, { force: true });
    await fs.rm(this.metaPathOf(objectPath), { force: true });
  }
}

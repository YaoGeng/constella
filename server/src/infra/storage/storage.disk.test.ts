/**
 * T2-12 验收：`vitest run storage -t disk` 全绿。
 * 覆盖（TDD-S-05 §6.1 disk 部分）：put→getStream roundtrip 字节一致（Buffer/流式）、
 * .meta.json 落位、delete 后 getStream 抛 StorageNotFound、
 * signedUrl 抛 StoragePresignUnsupported、穿越 key put 被拒、factory 默认 disk 单例。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { DiskStorage } from "./disk.storage.js";
import { getStorage, resetStorageForTests } from "./storage.factory.js";
import {
  StorageKeyInvalid,
  StorageNotFound,
  StoragePresignUnsupported,
} from "./storage.types.js";
import type { StorageAdapter } from "./storage.types.js";

let rootDir: string;
let storage: StorageAdapter;

beforeAll(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "constella-storage-disk-"));
  storage = new DiskStorage(rootDir);
});

afterAll(async () => {
  await fs.rm(rootDir, { recursive: true, force: true });
});

async function readAll(readable: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("disk", () => {
  it("put(Buffer)→getStream roundtrip 字节一致，.meta.json 落位且内容正确", async () => {
    const key = "packages/pkg-1/1.0.0.zip";
    const body = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03, 0x04]);
    const meta = { contentType: "application/zip", checksum: "sha256:ab12cd34" } as const;

    const result = await storage.put(key, body, meta);
    expect(result).toEqual({ key, sizeBytes: body.length });

    const roundtrip = await readAll(await storage.getStream(key));
    expect(roundtrip.equals(body)).toBe(true);

    const metaRaw = await fs.readFile(path.join(rootDir, "packages/pkg-1/1.0.0.zip.meta.json"), "utf8");
    const metaFile = JSON.parse(metaRaw) as Record<string, unknown>;
    expect(metaFile["contentType"]).toBe("application/zip");
    expect(metaFile["checksum"]).toBe("sha256:ab12cd34");
    expect(metaFile["sizeBytes"]).toBe(body.length);
  });

  it("put(Readable) 流式写入 roundtrip，sizeBytes 按实际字节统计", async () => {
    const key = "packages/pkg-2/2.0.0.zip";
    const body = Buffer.alloc(1024, 7);
    const meta = { contentType: "application/zip", checksum: "sha256:ef56" } as const;

    const result = await storage.put(key, Readable.from([body.subarray(0, 300), body.subarray(300)]), meta);
    expect(result.sizeBytes).toBe(1024);

    const roundtrip = await readAll(await storage.getStream(key));
    expect(roundtrip.equals(body)).toBe(true);
  });

  it("delete 后 getStream 抛 StorageNotFound", async () => {
    const key = "packages/pkg-3/3.1.4.zip";
    await storage.put(key, Buffer.from("zip-bytes"), { contentType: "application/zip", checksum: "sha256:x" });

    await storage.delete(key);

    await expect(storage.getStream(key)).rejects.toBeInstanceOf(StorageNotFound);
    // 同伴 .meta.json 一并清除
    await expect(fs.access(path.join(rootDir, "packages/pkg-3/3.1.4.zip.meta.json"))).rejects.toThrow();
  });

  it("signedUrl 抛 StoragePresignUnsupported（能力声明非静默降级）", async () => {
    await expect(storage.signedUrl("packages/pkg-1/1.0.0.zip")).rejects.toBeInstanceOf(
      StoragePresignUnsupported,
    );
  });

  it("穿越 key put 被拒（../、嵌套 ../、绝对路径、反斜杠、空段）", async () => {
    const evilKeys = ["../escape.zip", "packages/a/../../escape.zip", "/etc/passwd.zip", "a\\b.zip", "a//b.zip"];
    for (const key of evilKeys) {
      await expect(
        storage.put(key, Buffer.from("x"), { contentType: "application/zip", checksum: "sha256:x" }),
      ).rejects.toBeInstanceOf(StorageKeyInvalid);
    }
    // 越权写未发生：rootDir 之外无新文件
    await expect(fs.access(path.join(path.dirname(rootDir), "escape.zip"))).rejects.toThrow();
  });
});

describe("storage factory", () => {
  it("默认驱动 disk，单例复用（T2-12 只落 disk；s3 随 T2-13）", () => {
    resetStorageForTests();
    const a = getStorage();
    const b = getStorage();
    expect(a).toBeInstanceOf(DiskStorage);
    expect(b).toBe(a);
  });
});

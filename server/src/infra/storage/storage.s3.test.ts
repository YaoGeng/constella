/**
 * T2-13 验收：S3Storage 契约套件（TDD-S-05 §6.1 s3 侧——与 disk 套件同契约面）。
 * 本地无 docker/MinIO：S3_TEST_ENDPOINT 未设 → describe.skipIf 跳过并打印提示
 * （真跑面=部署期 minio 容器或 CI：S3_TEST_ENDPOINT=http://127.0.0.1:9000
 *  S3_TEST_ACCESS_KEY_ID/S3_TEST_SECRET_ACCESS_KEY/S3_TEST_BUCKET〔默认 constella-test〕/
 *  S3_TEST_REGION〔默认 us-east-1〕；02 §5.3 compose 已备 minio 位）。
 * 覆盖：put→getStream roundtrip（Buffer/流式）、delete 后 getStream 抛 StorageNotFound、
 * signedUrl 仅 GET（presign 出 URL 且真 GET 200）、穿越 key put 被拒（与 disk 同规则）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { S3Storage } from "./s3.storage.js";
import { StorageKeyInvalid, StorageNotFound } from "./storage.types.js";
import type { StorageAdapter } from "./storage.types.js";

const S3_TEST_ENDPOINT = process.env.S3_TEST_ENDPOINT;

if (!S3_TEST_ENDPOINT) {
  // 提示面：跳过原因与部署期补跑指引（S-05 §6.1 s3 侧占位真跑=MinIO 起容器后设 env 重跑本套件）
  console.warn(
    "[skip] storage.s3: S3_TEST_ENDPOINT 未设——S3 侧契约套件跳过（本地无 docker/MinIO）。" +
      "部署期补跑：起 minio 容器后设 S3_TEST_ENDPOINT/S3_TEST_ACCESS_KEY_ID/S3_TEST_SECRET_ACCESS_KEY（可选 S3_TEST_BUCKET/S3_TEST_REGION）再执行 `pnpm -F ./server exec vitest run storage.s3`。",
  );
}

async function readAll(readable: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe.skipIf(!S3_TEST_ENDPOINT)("s3 contract", () => {
  let storage: StorageAdapter;
  const prefix = `vitest-s3/${Date.now()}`;

  beforeAll(() => {
    storage = new S3Storage({
      bucket: process.env.S3_TEST_BUCKET ?? "constella-test",
      region: process.env.S3_TEST_REGION ?? "us-east-1",
      accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "minioadmin",
      secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "minioadmin",
      endpoint: S3_TEST_ENDPOINT,
      forcePathStyle: true,
    });
  });

  afterAll(async () => {
    if (!storage) return;
    // 清扫本套件对象（键确定性派生——逐一 delete 幂等）
    for (const key of [
      `${prefix}/pkg-1/1.0.0.zip`,
      `${prefix}/pkg-2/2.0.0.zip`,
      `${prefix}/pkg-3/3.1.4.zip`,
    ]) {
      await storage.delete(key).catch(() => undefined);
    }
  });

  it("put(Buffer)→getStream roundtrip 字节一致；sizeBytes 正确", async () => {
    const key = `${prefix}/pkg-1/1.0.0.zip`;
    const body = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03, 0x04]);
    const result = await storage.put(key, body, { contentType: "application/zip", checksum: "sha256:ab12cd34" });
    expect(result).toEqual({ key, sizeBytes: body.length });

    const roundtrip = await readAll(await storage.getStream(key));
    expect(roundtrip.equals(body)).toBe(true);
  });

  it("put(Readable) 流式上传 roundtrip", async () => {
    const key = `${prefix}/pkg-2/2.0.0.zip`;
    const body = Buffer.alloc(2048, 9);
    const result = await storage.put(
      key,
      Readable.from([body.subarray(0, 700), body.subarray(700)]),
      { contentType: "application/zip", checksum: "sha256:ef56" },
    );
    expect(result.sizeBytes).toBe(2048);
    const roundtrip = await readAll(await storage.getStream(key));
    expect(roundtrip.equals(body)).toBe(true);
  });

  it("delete 后 getStream 抛 StorageNotFound", async () => {
    const key = `${prefix}/pkg-3/3.1.4.zip`;
    await storage.put(key, Buffer.from("zip-bytes"), { contentType: "application/zip", checksum: "sha256:x" });
    await storage.delete(key);
    await expect(storage.getStream(key)).rejects.toBeInstanceOf(StorageNotFound);
  });

  it("signedUrl presign 出 URL（仅 GET；TTL 300s 设计值）且 GET 200", async () => {
    const key = `${prefix}/pkg-1/1.0.0.zip`;
    const url = await storage.signedUrl(key, { expiresInSec: 300 });
    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
    // 真 GET（对 MinIO endpoint；AWS 原生同语义）——策略①只预签名 GET 的实证面
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03, 0x04]))).toBe(true);
  });

  it("穿越 key put 被拒（../、绝对路径、反斜杠、空段——与 disk 同规则）", async () => {
    const evilKeys = ["../escape.zip", "packages/a/../../escape.zip", "/etc/passwd.zip", "a\\b.zip", "a//b.zip"];
    for (const key of evilKeys) {
      await expect(
        storage.put(key, Buffer.from("x"), { contentType: "application/zip", checksum: "sha256:x" }),
      ).rejects.toBeInstanceOf(StorageKeyInvalid);
    }
  });
});

/**
 * T2-06 验收：publish 处理序（TDD-S-02 §6.1d/e/f/g＋§6.3 限流；mine 驳回理由）。
 * d) 恶意 zip 用例（../、>500 条、脚本 >512KB、symlink、超大文件、非 zip、manifest 非法）→ 400 MARKET-FILE-INVALID；
 * e) 同 checksum 重发 → 202 同 packageId 不新建；
 * f) 首发 semver≠1.0.0 → 400；再发布须大于既有最大（409 CONFLICT）；
 * g) perms 推导：仅「数据」类目自定义节点 → ['文件']、仅内置 → []；
 * §6.3 publish 连发超 6/min → 429 RATE-LIMITED。
 * beforeEach 重置 kernel 限流桶（路由级 6/min 规则避免跨用例污染——测试即装配证据）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// 隧道 DB 延迟放大单用例查询轮次——放宽本套件超时（vitest 默认 5s）
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { resetRateLimitForTests } from "../../kernel/rate-limit.js";
import { getStorage } from "../../infra/storage/storage.factory.js";
import { prisma } from "../../utils/prisma.js";
import { buildZip, samplePackageZip } from "./testing/zip-builder.js";

const app = buildApp();
const EMAIL_PREFIX = "vitest-market-pub-";

function uniqueEmail(): string {
  return `${EMAIL_PREFIX}${randomUUID()}@test.local`;
}

let accessToken = "";
let userId = "";

/** Buffer → BlobPart（@types/node 25 泛型化 TypedArray 后 Buffer 不直赋 BlobPart） */
function toBlobPart(buf: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buf.byteLength);
  new Uint8Array(arrayBuffer).set(buf);
  return arrayBuffer;
}

async function publishRequest(zip: Buffer, meta: unknown, token = accessToken): Promise<Response> {
  const form = new FormData();
  form.append("file", new File([toBlobPart(zip)], "pkg.zip", { type: "application/zip" }));
  form.append("meta", typeof meta === "string" ? meta : JSON.stringify(meta));
  return app.request("/api/market/packages", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
}

const META = { kind: "node" as const, name: "测试发布包", summary: "摘要" };

beforeAll(async () => {
  const email = uniqueEmail();
  await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "12345678" }),
  });
  const login = (await (await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "12345678" }),
  })).json()) as { accessToken: string; user: { id: string } };
  accessToken = login.accessToken;
  userId = login.user.id;
});

beforeEach(() => {
  resetRateLimitForTests();
});

afterAll(async () => {
  // 两轮清扫（T6-17 对齐：user 删除移出 pkgIds 空集守卫——无包用户不漏删；第一轮后再查一次
  // 防超时残留的 in-flight 写入造成漏删→FK 拦截）
  for (let round = 0; round < 2; round++) {
    const users = await prisma.user.findMany({ where: { email: { startsWith: EMAIL_PREFIX } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) break;
    const pkgs = await prisma.package.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
    const pkgIds = pkgs.map((p) => p.id);
    const versions = pkgIds.length > 0 ? await prisma.packageVersion.findMany({ where: { packageId: { in: pkgIds } } }) : [];
    const storage = getStorage();
    for (const v of versions) {
      await storage.delete(v.storageKey).catch(() => undefined);
    }
    if (pkgIds.length > 0) {
      await prisma.package.updateMany({ where: { id: { in: pkgIds } }, data: { latestVersionId: null } });
      await prisma.$transaction([
        prisma.packageVersion.deleteMany({ where: { packageId: { in: pkgIds } } }),
        prisma.reviewRecord.deleteMany({ where: { packageId: { in: pkgIds } } }),
        prisma.downloadStat.deleteMany({ where: { packageId: { in: pkgIds } } }),
        prisma.package.deleteMany({ where: { id: { in: pkgIds } } }),
      ]);
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

describe("market publish", () => {
  it("无 token → 401", async () => {
    const res = await publishRequest(samplePackageZip({}), META, "");
    expect(res.status).toBe(401);
  });

  it("①~⑥ 全链路 202：PENDING 落库＋perms 推导＋checksum＋存储对象＋isAuthor", async () => {
    const zip = samplePackageZip({ name: META.name, nodes: [{ type: "custom.data-query", category: "数据" }] });
    const res = await publishRequest(zip, META);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { packageId: string; status: string; perms: string[]; checksum: string };
    expect(body.status).toBe("pending");
    expect(body.perms).toEqual(["文件"]); // g) 数据→文件
    expect(body.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);

    const pkg = await prisma.package.findUnique({
      where: { id: body.packageId },
      include: { versions: true, owner: true, latestVersion: true },
    });
    expect(pkg?.status).toBe("PENDING");
    expect(pkg?.kind).toBe("NODE");
    expect(pkg?.ownerUserId).toBe(userId);
    expect(pkg?.owner.isAuthor).toBe(true); // D-1 首次发布置 isAuthor
    expect(pkg?.versions).toHaveLength(1);
    expect(pkg?.versions[0]?.semver).toBe("1.0.0");
    expect(pkg?.versions[0]?.checksum).toBe(body.checksum);
    expect(pkg?.versions[0]?.sizeBytes).toBe(zip.length); // 归档大小口径
    expect(pkg?.versions[0]?.manifest).toMatchObject({ kind: "node", name: "测试发布包", version: "1.0.0" });

    const stream = await getStorage().getStream(`packages/${body.packageId}/1.0.0.zip`);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    expect(Buffer.concat(chunks).equals(zip)).toBe(true);
  });

  it("e) 同 checksum 重发 → 202 同 packageId 不新建（版本行恰一）", async () => {
    const zip = samplePackageZip({ name: "幂等包" });
    const meta = { ...META, name: "幂等包" };
    const first = (await (await publishRequest(zip, meta)).json()) as { packageId: string; checksum: string };
    const second = await publishRequest(zip, meta);
    expect(second.status).toBe(202);
    const body2 = (await second.json()) as { packageId: string; checksum: string };
    expect(body2.packageId).toBe(first.packageId);
    expect(body2.checksum).toBe(first.checksum);
    const count = await prisma.packageVersion.count({ where: { packageId: first.packageId } });
    expect(count).toBe(1);
  });

  it("f) 首发 semver≠1.0.0 → 400 MARKET-FILE-INVALID；格式非法 → 400", async () => {
    const badFirst = await publishRequest(samplePackageZip({ name: "首发版本包", version: "1.0.1" }), { ...META, name: "首发版本包" });
    expect(badFirst.status).toBe(400);
    expect(((await badFirst.json()) as { error: { code: string } }).error.code).toBe("MARKET-FILE-INVALID");

    const badFormat = await publishRequest(
      samplePackageZip({ name: "坏格式包", manifestOverride: JSON.stringify({ kind: "node", name: "坏格式包", version: "1.x.0" }) }),
      { ...META, name: "坏格式包" },
    );
    expect(badFormat.status).toBe(400);
    expect(((await badFormat.json()) as { error: { code: string } }).error.code).toBe("MARKET-FILE-INVALID");
  });

  it("再发布：复用包＋新版本＋status 重置 PENDING；semver 不增 → 409 CONFLICT", async () => {
    const name = "再发布包";
    const meta = { ...META, name };
    const v1 = (await (await publishRequest(samplePackageZip({ name, version: "1.0.0" }), meta)).json()) as { packageId: string };

    // 审核通过后复审期再发布 → 重置 PENDING（复审期从列表隐藏）
    await prisma.package.update({ where: { id: v1.packageId }, data: { status: "APPROVED" } });
    const v2 = await publishRequest(samplePackageZip({ name, version: "1.1.0" }), meta);
    expect(v2.status).toBe(202);
    const body2 = (await v2.json()) as { packageId: string; status: string };
    expect(body2.packageId).toBe(v1.packageId);
    expect(body2.status).toBe("pending");
    const pkg = await prisma.package.findUnique({ where: { id: v1.packageId }, include: { versions: true, latestVersion: true } });
    expect(pkg?.status).toBe("PENDING");
    expect(pkg?.versions.map((v) => v.semver).sort()).toEqual(["1.0.0", "1.1.0"]);
    expect(pkg?.latestVersion?.semver).toBe("1.1.0");

    // 不增：小于既有最大
    const lower = await publishRequest(samplePackageZip({ name, version: "0.9.0" }), meta);
    expect(lower.status).toBe(409);
    expect(((await lower.json()) as { error: { code: string } }).error.code).toBe("CONFLICT");
    // 相等（撞 @@unique 与不增规则同归 409）
    const equal = await publishRequest(samplePackageZip({ name, version: "1.1.0", nodes: [{ type: "custom.x" }] }), meta);
    expect(equal.status).toBe(409);
  });

  it("d) 恶意 zip：`..` 条目 / 绝对路径 / 反斜杠 → 400 MARKET-FILE-INVALID", async () => {
    for (const evilName of ["../evil.txt", "/etc/passwd", "a\\b.txt", "nodes/../../x.json"]) {
      const res = await publishRequest(
        samplePackageZip({ name: "恶意包", extraEntries: [{ name: evilName, data: Buffer.from("x") }] }),
        { ...META, name: "恶意包" },
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("MARKET-FILE-INVALID");
    }
  });

  it("d) 恶意 zip：条目 >500 / 脚本 >512KB / 单文件 >2MB / symlink 条目 → 400", async () => {
    const tooMany = buildZip(
      Array.from({ length: 501 }, (_, i) => ({ name: `nodes/n${i}.json`, data: Buffer.from("{}", "utf8") })),
    );
    const r1 = await publishRequest(tooMany, { ...META, name: "超量包" });
    expect(r1.status).toBe(400);

    const bigScript = samplePackageZip({
      name: "大脚本包",
      nodes: [{ type: "custom.big", category: "AI" }],
      extraEntries: [{ name: "scripts/huge.py", data: Buffer.alloc(512 * 1024 + 1, 0x61) }],
    });
    const r2 = await publishRequest(bigScript, { ...META, name: "大脚本包" });
    expect(r2.status).toBe(400);
    expect(((await r2.json()) as { error: { code: string } }).error.code).toBe("MARKET-FILE-INVALID");

    const bigFile = samplePackageZip({
      name: "大文件包",
      extraEntries: [{ name: "deps/huge.bin", data: Buffer.alloc(2 * 1024 * 1024 + 1, 0x62) }],
    });
    const r3 = await publishRequest(bigFile, { ...META, name: "大文件包" });
    expect(r3.status).toBe(400);

    const symlinkZip = samplePackageZip({
      name: "链接包",
      nodes: [{ type: "custom.ln", category: "网络" }],
      extraEntries: [{ name: "scripts/link.py", data: Buffer.from("/etc/passwd", "utf8"), unixMode: 0o120777 }],
    });
    const r4 = await publishRequest(symlinkZip, { ...META, name: "链接包" });
    expect(r4.status).toBe(400);
  });

  it("d) 非 zip 字节 / manifest 坏 JSON / manifest 缺字段 / meta↔manifest 不一致 → 400", async () => {
    const notZip = await publishRequest(Buffer.from("definitely not a zip archive"), META);
    expect(notZip.status).toBe(400);

    const badJson = await publishRequest(
      samplePackageZip({ name: "坏JSON包", manifestOverride: "{not-json" }),
      { ...META, name: "坏JSON包" },
    );
    expect(badJson.status).toBe(400);

    const missingField = await publishRequest(
      samplePackageZip({ name: "缺字段包", manifestOverride: JSON.stringify({ kind: "node", name: "缺字段包" }) }),
      { ...META, name: "缺字段包" },
    );
    expect(missingField.status).toBe(400);

    const mismatch = await publishRequest(
      samplePackageZip({ name: "包内名", version: "1.0.0" }),
      { ...META, name: "表单名" },
    );
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as { error: { code: string } }).error.code).toBe("MARKET-FILE-INVALID");
  });

  it("meta 校验失败（name 超 24/缺 kind/坏 JSON）→ 400 VALIDATION-FAILED", async () => {
    const longName = await publishRequest(samplePackageZip({ name: "x".repeat(25) }), { ...META, name: "x".repeat(25) });
    expect(longName.status).toBe(400);
    expect(((await longName.json()) as { error: { code: string } }).error.code).toBe("VALIDATION-FAILED");

    const form = new FormData();
    form.append("file", new File([toBlobPart(samplePackageZip({}))], "pkg.zip", { type: "application/zip" }));
    form.append("meta", "{broken");
    const badMetaJson = await app.request("/api/market/packages", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: form,
    });
    expect(badMetaJson.status).toBe(400);
    expect(((await badMetaJson.json()) as { error: { code: string } }).error.code).toBe("VALIDATION-FAILED");

    const noKind = await publishRequest(samplePackageZip({}), { name: "无类别", summary: "s" });
    expect(noKind.status).toBe(400);
  });

  it("g) perms 推导：仅内置 → []；多类目按封闭集顺序输出；未命中类目不产生", async () => {
    const builtinOnly = await publishRequest(
      samplePackageZip({ name: "内置包", nodes: [{ type: "ai.llm", kind: "builtin", category: "AI" }] }),
      { ...META, name: "内置包" },
    );
    expect(builtinOnly.status).toBe(202);
    expect(((await builtinOnly.json()) as { perms: string[] }).perms).toEqual([]);

    const mixed = await publishRequest(
      samplePackageZip({
        name: "混合包",
        nodes: [
          { type: "custom.a", category: "社媒" },
          { type: "custom.b", category: "CDP" },
          { type: "custom.c", category: "数据" },
          { type: "custom.d", category: "触发" },
          { type: "custom.e", category: "逻辑" },
        ],
      }),
      { ...META, name: "混合包" },
    );
    expect(mixed.status).toBe(202);
    expect(((await mixed.json()) as { perms: string[] }).perms).toEqual(["CDP", "文件", "社媒"]);
  });

  it("deflate 档 zip 同样可解析（01 A-12.01 X-7 读端兼容）", async () => {
    const res = await publishRequest(
      samplePackageZip({ name: "压缩档包", method: "deflate", nodes: [{ type: "custom.z", category: "交互" }] }),
      { ...META, name: "压缩档包" },
    );
    expect(res.status).toBe(202);
    expect(((await res.json()) as { perms: string[] }).perms).toEqual(["交互"]);
  });

  it("§6.3 连发 7 次（限流 6/min）→ 第 7 次 429 RATE-LIMITED", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await publishRequest(samplePackageZip({ name: `限流包${i}`, version: "1.0.0" }), { ...META, name: `限流包${i}` });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 6)).toEqual([202, 202, 202, 202, 202, 202]);
    expect(statuses[6]).toBe(429);
  });
});

describe("market mine", () => {
  it("全状态可见＋REJECTED 包驳回理由（PRD-A13-02）", async () => {
    const name = "驳回来由包";
    const meta = { ...META, name };
    const created = (await (await publishRequest(samplePackageZip({ name }), meta)).json()) as { packageId: string };
    await prisma.package.update({ where: { id: created.packageId }, data: { status: "REJECTED" } });
    await prisma.reviewRecord.create({
      data: {
        packageId: created.packageId,
        reviewerId: userId,
        action: "REJECT",
        reason: "脚本含未声明的文件写权限",
      },
    });

    const res = await app.request("/api/market/mine", { headers: { authorization: `Bearer ${accessToken}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; name: string; status: string; reviewReason?: string }>;
      total: number;
    };
    const item = body.items.find((i) => i.id === created.packageId);
    expect(item?.status).toBe("rejected");
    expect(item?.reviewReason).toBe("脚本含未声明的文件写权限");
    expect(body.items.every((i) => typeof i.name === "string")).toBe(true);
  });

  it("无 token → 401", async () => {
    const res = await app.request("/api/market/mine");
    expect(res.status).toBe(401);
  });
});

/**
 * market 域请求校验 Schema（TDD-S-02 §3；T2-05/06/07）。
 * Zod v4 plain z.* 写法＝zod-openapi 兼容约定（全 /api 跨域约定，OpenApiDoc 只聚合不定义——
 * hono-openapi 未安装，本批 OpenAPI 为手写 JSON 路由，见 openapi.ts）。
 * manifest 校验源型＝X-01 ./manifest PackageManifest（manifestSchema 以 z.ZodType 注解强制与共享类型逐字段一致）。
 */
import { z } from "zod";
import type { PackageManifest } from "@constella/shared/manifest";

/** 资产类别小写字面量（02 §6.2 kind=node|pack|flow；DB 枚举大写由 KIND_TO_ENUM 映射） */
export const PACKAGE_KINDS = ["node", "pack", "flow"] as const;

/** kind 小写 ↔ Prisma 枚举大写边界映射（03 S-02 §1 列表行） */
export const KIND_TO_ENUM = { node: "NODE", pack: "PACK", flow: "FLOW" } as const;
export const KIND_FROM_ENUM = { NODE: "node", PACK: "pack", FLOW: "flow" } as const;

/** 排序键（latest=updatedAt desc / downloads=downloadCount desc） */
export const LIST_SORTS = ["latest", "downloads"] as const;

/** GET /market/packages 查询参（page≥1、pageSize 默认 20 上限 100——设计值） */
export const listQuerySchema = z.object({
  kind: z.enum(PACKAGE_KINDS).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(LIST_SORTS).default("latest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

/** 路径参数：包 id 非空 */
export const idParamSchema = z.object({ id: z.string().min(1) });

/** POST /market/packages/:id/installs 请求体（`{}`；幂等键 userId+packageId+day，body 无业务字段） */
export const installReqSchema = z.object({}).strict();

/** semver 形（D-11：首发 1.0.0；容忍前导 v，存档前归一化去 v） */
export const SEMVER_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** manifest.json 主体（源型=X-01 ./manifest PackageManifest；02 §12.2#4 JSON Schema 校验的 Zod 落点） */
export const manifestSchema: z.ZodType<PackageManifest> = z.object({
  kind: z.enum(PACKAGE_KINDS),
  name: z.string().min(1),
  summary: z.string().optional(),
  version: z.string().regex(SEMVER_PATTERN),
  scripts: z
    .record(
      z.string(),
      z.object({
        file: z.string().min(1),
        lang: z.enum(["python", "ts"]),
        entry: z.string().min(1),
      }),
    )
    .optional(),
});

/** 发布表单元信息（multipart meta 字段；name≤24/summary≤40=PRD-A13-01 限额） */
export const publishMetaSchema = z.object({
  kind: z.enum(PACKAGE_KINDS),
  name: z.string().trim().min(1).max(24),
  summary: z.string().trim().max(40).optional(),
});
export type PublishMeta = z.infer<typeof publishMetaSchema>;

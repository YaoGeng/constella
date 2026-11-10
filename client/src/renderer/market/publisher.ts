// Publisher —— 发布编排（T5-11 / TDD-C-09 §3 Publisher 行＋§1 publish 行）。
//
// 编排序（§3 行原文）：弹窗（二选一类型＋勾选/整条预览＋name≤24/summary≤40 前端拦截＋perms
// 实时推导〔C-05 derivePerms——注入，同名同表类目→标签〕＋名称建议未聚焦才覆盖，demo
// L826-841/L2902-2913）→产物字节：
//   - node/pack＝✅ 02 v1.0f zip:export 字节变体（exportPackageBytes——multipart 免文件读回，
//     checksum=SHA-256 幂等键）；
//   - flow＝✅ 02 v1.0f 流程导出变体 zip（exportFlowBytes——nodes BFS 序物化 FlowSteps 序列化
//     语义，PM 裁决「不上传裸 steps JSON」；安装端 T5-10 已按此形冻结）；
// →client.publishPackage（multipart meta+file → 202 pending）→「已提交审核」toast；
// 断网/失败（MarketTransportError——network/timeout）→C-06 publish.queue 入队（不自动静默重试，
// 02 §1.3）；UNAUTHORIZED→登录引导（onUnauthorized 注入——LoginDialog 复用）。
//
// kind 推导：勾选 1 类型=node、≥2=pack（X-01 manifest kind 规则同源——server ManifestGuard 对端）；
// server 4xx（限额/校验等）不入队——需用户修正后重发（§6.5 只网络错误入队）。
import type { PendingPublishItem, StorageInvokeReq } from '@constella/shared/ipc';
import type { PermLabel, PublishAccepted } from '@constella/shared/dto';
import type { MarketPublishMeta } from './market-api-client';
import type { ExportBytesOutcome } from '../zip/export-orchestrator';
import { isMarketApiError, isMarketTransportError, isMarketUnauthorizedError } from './market-error';
import type { PendingByteStore } from './pending-publish-queue';

/** 发布类型（§1 publish meta.kind 三值） */
export type PublishKind = 'node' | 'pack' | 'flow';

/** §1 publish(meta, source) 的 source 形 */
export interface PublishSource {
  /** node/pack：勾选节点类型集（定义库 type） */
  types?: readonly string[];
  /** flow：整条流程（flows.list id） */
  flowId?: string;
}

/** §1 publish 返回联合：202 产物｜入队回执 */
export type PublishOutcome = PublishAccepted | { queued: true };

/** C-08 导出编排注入面（v1.0f 字节双变体——ExportOrchestrator 结构子集） */
export interface PublisherExportFace {
  exportPackageBytes(types: readonly string[], meta: { name: string }): Promise<ExportBytesOutcome>;
  exportFlowBytes(flowId: string): Promise<ExportBytesOutcome>;
}

/** 上传面（MarketApiClient.publishPackage 结构子集） */
export interface PublisherClientFace {
  publishPackage(meta: MarketPublishMeta, file: { data: Uint8Array; filename: string }): Promise<PublishAccepted>;
}

export interface PublisherDeps {
  client: PublisherClientFace;
  exporter: PublisherExportFace;
  /** C-06 publish.queue（storage:invoke 面） */
  storageInvoke(req: StorageInvokeReq): Promise<unknown>;
  /** 会话字节仓（与 PendingPublishQueue 共用——装配位注入同一实例） */
  byteStore: PendingByteStore;
  /** toast 面（「已提交审核」demo L2907/断网入队提示） */
  notify(level: 'info' | 'ok' | 'warn' | 'err', msg: string): void;
  /** 登录引导（LoginDialog 打开——UNAUTHORIZED 捕获面；装配位注入） */
  onUnauthorized?(): void;
  log?: (...args: unknown[]) => void;
}

/** 队列行 filePath 标记（⚠ 卡内冻结：v1.0f 后无 renderer fs 写通道——字节在会话内存仓，
 *  列值非文件路径；字节持久化=V2 扩展点，见 pending-publish-queue.ts 模块头） */
export function pendingFilePathOf(checksum: string): string {
  return `market-pending:${checksum}`;
}

export interface Publisher {
  /** §1 组件级接口：publish(meta, source)——产物→上传/入队 */
  publish(meta: { kind: PublishKind; name: string; summary?: string }, source: PublishSource): Promise<PublishOutcome>;
}

function isUnauthorized(e: unknown): boolean {
  return isMarketUnauthorizedError(e) || (isMarketApiError(e) && e.code === 'UNAUTHORIZED');
}

export function createPublisher(deps: PublisherDeps): Publisher {
  return {
    async publish(meta, source) {
      // ———— ① 产物字节（v1.0f 字节双变体——不落盘；checksum=SHA-256 幂等键） ————
      const outcome: ExportBytesOutcome =
        meta.kind === 'flow'
          ? await deps.exporter.exportFlowBytes(source.flowId!)
          : await deps.exporter.exportPackageBytes(source.types ?? [], { name: meta.name });

      // ———— ② 上传（multipart meta+file → 202 pending）————
      try {
        const accepted = await deps.client.publishPackage(
          { kind: meta.kind, name: meta.name, ...(meta.summary !== undefined ? { summary: meta.summary } : {}) },
          { data: outcome.bytes, filename: `constella-${meta.name.replace(/[\\/:*?"<>|]/g, '_') || 'package'}.zip` },
        );
        deps.notify('ok', `「${meta.name}」已提交审核——审核通过后将在广场上架`); // demo L2907「已提交审核」
        deps.log?.(`[market] publish ok ${meta.kind}/${meta.name} checksum=${outcome.checksum}`);
        return accepted;
      } catch (err) {
        // ———— ③ 断网/失败→C-06 publish.queue 入队（不自动静默重试——02 §1.3） ————
        if (isMarketTransportError(err)) {
          deps.byteStore.put(outcome.checksum, outcome.bytes);
          const queueMeta: PendingPublishItem['meta'] = {
            kind: meta.kind,
            name: meta.name,
            ...(meta.summary !== undefined ? { summary: meta.summary } : {}),
            checksum: outcome.checksum,
          };
          await deps.storageInvoke({
            op: 'publish.queue',
            args: { meta: queueMeta, filePath: pendingFilePathOf(outcome.checksum) },
          });
          deps.notify('warn', `网络不可用——「${meta.name}」已加入待发布队列，联网后可补交`);
          deps.log?.(`[market] publish 断网入队 ${meta.kind}/${meta.name} checksum=${outcome.checksum}`);
          return { queued: true };
        }
        if (isUnauthorized(err)) {
          deps.notify('err', '登录后才能发布——请先登录');
          deps.onUnauthorized?.();
        }
        throw err; // server 4xx 等——不入队（用户修正后重发）
      }
    },
  };
}

// ————————————————————————————————————————————
// 发布弹窗纯逻辑（PublisherDialog 消费——前端拦截/名称建议/perms 推导可单测的半段）
// ———————————————————————————————————————————

/** 限额（S-02：name≤24/summary≤40——server publishMetaSchema 对端） */
export const PUBLISH_NAME_MAX = 24;
export const PUBLISH_SUMMARY_MAX = 40;

/** 表单校验（前端拦截——§6.4：name>24/summary>40 拦截不上传） */
export function validatePublishForm(name: string, summary: string, selectedCount: number, kind: PublishKind): string | null {
  if (name.trim().length === 0) return '名称不能为空';
  if (name.length > PUBLISH_NAME_MAX) return `名称不能超过 ${PUBLISH_NAME_MAX} 字`;
  if (summary.length > PUBLISH_SUMMARY_MAX) return `简介不能超过 ${PUBLISH_SUMMARY_MAX} 字`;
  if (kind !== 'flow' && selectedCount === 0) return '先勾选要发布的节点类型';
  return null;
}

/** meta.kind 推导（X-01 manifest kind 规则：单类型=node、类型集=pack；flow 显式） */
export function derivePublishKind(mode: 'node' | 'flow', types: readonly string[]): PublishKind {
  if (mode === 'flow') return 'flow';
  return types.length === 1 ? 'node' : 'pack';
}

/** 名称建议（demo L2902-2913：未聚焦才覆盖——聚焦判定在组件；此处纯值推导） */
export function suggestPublishName(
  mode: 'node' | 'flow',
  types: readonly string[],
  flowName: string | null,
  typeNameOf: (type: string) => string,
): string {
  if (mode === 'flow') return flowName ?? '';
  if (types.length === 1) return typeNameOf(types[0]!);
  if (types.length > 1) return `${types.length} 个精选节点`;
  return '';
}

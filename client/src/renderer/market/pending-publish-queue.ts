// PendingPublishQueue —— 待发布队列（T5-11 / TDD-C-09 §3 组件行＋§1 flushPending 行）。
//
// 职责（§3 行原文）：C-06 publish.list/remove＋联网恢复补交提示＋flushPending——逐条走**同一
// 上传 API**（01 §8.3/X-21：补交=multipart POST /api/market/packages，非任何旁路）；成功出队
// （publish.remove）、失败保留；**不自动静默重试**（02 §1.3——避免重复上架；幂等键=内容
// SHA-256 存 meta，C-06 §1 冻结口径）。
//
// ⚠ 卡内冻结（产物字节源——v1.0f 后 24 通道面内无 renderer fs 写通道）：断网入队时 zip 字节
// 由 Publisher 经 zip:export **字节变体**取得（{bytes,checksum}），字节保存在**会话内存**
// PendingByteStore（checksum 键）；pending_publish 行 filePath 列记 `market-pending:<checksum>`
// 标记（非文件路径——列形冻结 TEXT 不改，语义留痕）。跨进程重启后队列行保留但字节不可达——
// flushPending 对此类行计数 failed 且保留（提示重发布）；**字节持久化=V2 扩展点**（与 v1.0e
// 下载临时文件缓存同族，02 §3.4 v1.0e 勘误转 V2 缓存复用扩展点先例）。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PendingPublishItem, StorageInvokeReq } from '@constella/shared/ipc';
import type { MarketPublishMeta } from './market-api-client';
import { isMarketTransportError } from './market-error';

/** 会话内存字节仓（⚠ 卡内冻结：checksum→zip 字节；跨重启不可达→flush 计 failed 保留） */
export interface PendingByteStore {
  put(checksum: string, bytes: Uint8Array): void;
  /** miss=undefined（字节不可达——重启后队列行的失败保留分支） */
  take(checksum: string): Uint8Array | undefined;
  size(): number;
}

export function createPendingByteStore(): PendingByteStore {
  const map = new Map<string, Uint8Array>();
  return {
    put: (checksum, bytes) => map.set(checksum, bytes),
    take: (checksum) => map.get(checksum),
    size: () => map.size,
  };
}

/** C-06 storage 面（publish.queue/list/remove 结构子集） */
export interface PendingStorageFace {
  invoke(req: StorageInvokeReq): Promise<unknown>;
}

/** 上传面（MarketApiClient.publishPackage 结构子集——补交走同一上传 API） */
export interface PendingUploadFace {
  publishPackage(meta: MarketPublishMeta, file: { data: Uint8Array; filename: string }): Promise<unknown>;
}

export interface PendingPublishQueueDeps {
  storage: PendingStorageFace;
  client: PendingUploadFace;
  /** 会话字节仓（与 Publisher 共用同一实例——装配位注入） */
  byteStore: PendingByteStore;
  notify?(level: 'info' | 'ok' | 'warn' | 'err', msg: string): void;
  log?: (...args: unknown[]) => void;
}

/** §6.5 flushPending 返回形（§1：{submitted,failed}） */
export interface FlushResult {
  submitted: number;
  failed: number;
}

/** 队列行上传文件名（manifest name 派生——server ManifestGuard 只读 meta↔manifest，文件名自由） */
function zipNameOf(item: PendingPublishItem): string {
  const stem = item.meta.name.replace(/[\\/:*?"<>|]/g, '_') || 'package';
  return `constella-${stem}.zip`;
}

export interface PendingPublishQueue {
  /** C-06 publish.list（设置页/发布弹窗队列视图数据源） */
  list(): Promise<{ items: PendingPublishItem[] }>;
  /** C-06 publish.remove（用户手动移除） */
  remove(id: string): Promise<void>;
  /** 联网恢复补交：逐条同一上传 API；成功出队、失败保留；无自动重试（返回不重发） */
  flushPending(): Promise<FlushResult>;
}

export function createPendingPublishQueue(deps: PendingPublishQueueDeps): PendingPublishQueue {
  return {
    async list() {
      return (await deps.storage.invoke({ op: 'publish.list' })) as { items: PendingPublishItem[] };
    },
    async remove(id) {
      await deps.storage.invoke({ op: 'publish.remove', args: { id } });
    },
    async flushPending() {
      const { items } = await this.list();
      let submitted = 0;
      let failed = 0;
      for (const item of items) {
        const bytes = deps.byteStore.take(item.meta.checksum);
        if (bytes === undefined) {
          // 字节不可达（跨重启遗留行）——保留＋计数，不静默丢弃（02 §1.3 无自动重试）
          failed++;
          deps.notify?.('warn', `「${item.meta.name}」产物字节不可达（跨重启遗留）——请移除后重新发布`);
          deps.log?.(`[market] flushPending 字节不可达 pkg=${item.meta.name} checksum=${item.meta.checksum}`);
          continue;
        }
        try {
          // 同一上传 API（X-21）——meta 形=发布三要素＋幂等键（C-06 §1 冻结口径）
          await deps.client.publishPackage(
            { kind: item.meta.kind, name: item.meta.name, ...(item.meta.summary !== undefined ? { summary: item.meta.summary } : {}) },
            { data: bytes, filename: zipNameOf(item) },
          );
          await deps.storage.invoke({ op: 'publish.remove', args: { id: item.id } });
          submitted++;
        } catch (err) {
          failed++;
          deps.log?.(`[market] flushPending 失败保留 pkg=${item.meta.name}:`, err);
          if (isMarketTransportError(err)) {
            // 仍离线——后续行必同因，提前收段（全部保留；不自动重试）
            deps.notify?.('warn', '网络仍不可用——待发布队列已保留，联网后可再次补交');
            break;
          }
          // server 4xx（如限额/校验）——单行问题：继续下一行（其余行不受牵连）
        }
      }
      if (submitted > 0) deps.notify?.('ok', `已补交 ${submitted} 个待发布项${failed > 0 ? `（${failed} 个失败保留）` : ''}`);
      return { submitted, failed };
    },
  };
}

// ————————————————————————————————————————————
// usePendingPublish（§3 组件级接口——设置页/发布弹窗队列视图）
// ———————————————————————————————————————————

export interface UsePendingPublish {
  items: PendingPublishItem[];
  loading: boolean;
  /** 补交中（按钮置灰位） */
  flushing: boolean;
  /** 最近一次补交结果（提示条） */
  lastFlush: FlushResult | null;
  refresh(): void;
  remove(id: string): Promise<void>;
  flush(): Promise<FlushResult | undefined>;
}

/** 队列视图 hook：publish.list 态＋remove/flushPending 动作位 */
export function usePendingPublish(queue: PendingPublishQueue): UsePendingPublish {
  const [items, setItems] = useState<PendingPublishItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [flushing, setFlushing] = useState(false);
  const [lastFlush, setLastFlush] = useState<FlushResult | null>(null);
  const [tick, setTick] = useState(0);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  useEffect(() => {
    let cancelled = false;
    queueRef.current
      .list()
      .then(({ items: rows }) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]); // storage 不可达——空投影（视图不弹错）
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const remove = useCallback(
    async (id: string) => {
      await queueRef.current.remove(id);
      setTick((t) => t + 1);
    },
    [],
  );
  const flush = useCallback(async () => {
    setFlushing(true);
    try {
      const res = await queueRef.current.flushPending();
      setLastFlush(res);
      setTick((t) => t + 1);
      return res;
    } finally {
      setFlushing(false);
    }
  }, []);

  return { items, loading, flushing, lastFlush, refresh, remove, flush };
}

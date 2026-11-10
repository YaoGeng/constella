// OfflineDegradation —— 离线降级器（T5-11 / TDD-C-09 §3 组件行＋§1 离线降级段）。
//
// 职责（§3 行原文）：离线判定（输入=TransportFailureKind——MarketApiClient 超时/网络错误分类，
// timeout=降级观察、network=疑似离线）、最近一次缓存列表只读投影（**会话内存不持久化——卡内
// 冻结 ⚠**，01 §8.3「最近一次缓存列表」持久化口径未定；V2 扩展点③）、安装置灰信号、广场 pill
// 离线态（B-9）。
//
// 判定源=注入的 report 面（装配位包住 list/detail 等市场请求：失败→report(kind)、成功→
// reportOnline）；联网恢复（offline→online 翻转）触发 onOnline 监听——PendingPublishQueue 的
// 「联网恢复补交提示」接此位（flushPending 仍手动触发——不自动静默重试，02 §1.3）。
// 本地功能零阻塞（01 §8.3）：降级器只投影状态，不拦截任何本地动作。
import { useEffect, useState } from 'react';
import type { MarketListQuery, MarketListRes } from '@constella/shared/dto';
import type { TransportFailureKind } from './market-error';

/** §3 组件级接口：state() 'online'|'offline'＋cachedList() */
export interface OfflineDegradation {
  /** 离线判定态（online=正常；offline=断网/服务不可达降级态） */
  state(): 'online' | 'offline';
  /** 最近一次成功列表响应的只读投影（会话内存 ⚠ 不持久化；无缓存=null——调用方自行空态） */
  cachedList(): MarketListRes | null;
  /** 缓存登记（装配位在每次成功 list 后喂入——query 任意，投影=「最近一次」） */
  cacheList(res: MarketListRes): void;
  /** 安装置灰信号（§1：断网-广场→安装按钮置灰） */
  installDisabled(): boolean;
  /** 传输失败上报（离线判定输入——MarketTransportError.kind） */
  report(kind: TransportFailureKind): void;
  /** 任一市场请求成功上报（offline→online 翻转——联网恢复信号） */
  reportOnline(): void;
  /** 状态翻转监听（B-9 pill/队列补交提示装配位）——返回卸载函数 */
  onStateChange(fn: (state: 'online' | 'offline') => void): () => void;
  /** 联网恢复一次性监听（offline→online 翻转即触发后自动卸载语义由调用方管理） */
  onOnline(fn: () => void): () => void;
}

export function createOfflineDegradation(): OfflineDegradation {
  let state: 'online' | 'offline' = 'online';
  let cached: MarketListRes | null = null;
  const listeners = new Set<(s: 'online' | 'offline') => void>();
  const onlineListeners = new Set<() => void>();

  function transition(next: 'online' | 'offline'): void {
    if (next === state) return;
    state = next;
    for (const fn of [...listeners]) fn(state);
    if (state === 'online') for (const fn of [...onlineListeners]) fn();
  }

  return {
    state: () => state,
    cachedList: () => cached,
    cacheList(res) {
      cached = res; // 只登记最近一次（query 无关——「最近一次缓存列表」口径）
    },
    installDisabled: () => state === 'offline',
    report(kind) {
      // network=疑似离线（fetch 拒绝）；timeout=降级观察（不翻转——慢≠断网）
      if (kind === 'network') transition('offline');
    },
    reportOnline() {
      transition('online');
    },
    onStateChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onOnline(fn) {
      onlineListeners.add(fn);
      return () => onlineListeners.delete(fn);
    },
  };
}

/** 缓存投影参数面（cachedList 消费：与原 query 合并只读投影——「可继续浏览」语义） */
export interface OfflineCacheProjection {
  offline: boolean;
  items: MarketListRes['items'];
  total: number;
}

/** 只读投影（断网 list 失败路径的渲染数据源——use-market-list error.last 同数据位；
 *  本组件持缓存副本供 B-9/装配位跨组件消费） */
export function projectCachedList(degradation: OfflineDegradation, _q?: MarketListQuery): OfflineCacheProjection | null {
  const cached = degradation.cachedList();
  if (cached === null) return null;
  return { offline: degradation.state() === 'offline', items: cached.items, total: cached.total };
}

/** B-9 广场 pill 离线态 hook（「离线」徽标——01 A-1.2 经 02 §1.3） */
export function useOfflineState(degradation: OfflineDegradation): 'online' | 'offline' {
  const [state, setState] = useState(degradation.state());
  useEffect(() => degradation.onStateChange(setState), [degradation]);
  return state;
}

// SessionViewer —— 全屏查看窗编排（T4-06；TDD-C-04 §1 管理面段＋§3 SessionViewer 行；
// demo L2848-2868 行为源）。
//
// 语义（A-8.2）：open(runId,laneKey)=打开/置顶全屏查看窗——同会话再点只置顶（DOM 序末尾）
// 不再发 cdp:openViewer（「恰一次」）；✕ 只关查看窗不中断自动化（无任何通道调用——统一
// 销毁归 C-03 终止组件的 cdp:destroyRun）。渲染=主窗 DOM overlay（02 §11 B-10 两路之一，
// §8 替换点②：独立 BrowserWindow/WebContentsView 路收窄在装配层换件——本组件 overlay 形
// jsdom 可测；cdp:openViewer 的 main 侧查看窗原语=T4-13 ViewerOpenerFace，双轨不冲突）。
import { useEffect, useState } from 'react';
import type { CdpManagerChannels } from './manager-channels';
import type { CdpSessionsModel } from './cdp-sessions-model';
import { stripUrlProtocol } from './cdp-sessions-model';

/** 已开查看窗标识（runId＋laneKey 双键——跨 run 同 laneKey 不互斥） */
export interface ViewerEntry {
  runId: string;
  laneKey: string;
}

/** §1 SessionViewer 接口（TDD-C-04 §1 逐字：open(runId,laneKey)——打开/置顶） */
export interface SessionViewer {
  open(runId: string, laneKey: string): void;
}

/** 查看窗编排控制器（面板渲染之外的观测面——entries 底→顶序/close/订阅） */
export interface SessionViewerController extends SessionViewer {
  /** ✕ 关窗（仅本地面板状态——零通道调用，A-8.2） */
  close(runId: string, laneKey: string): void;
  /** 已开查看窗（底→顶；末尾=置顶层） */
  entries(): ViewerEntry[];
  /** 开/关/置顶变更订阅（面板 re-render 触发源）；返回退订 */
  onChange(fn: () => void): () => void;
}

export function createSessionViewer(channels: CdpManagerChannels): SessionViewerController {
  const stack: ViewerEntry[] = []; // 底→顶
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const fn of [...listeners]) fn();
  };
  const find = (runId: string, laneKey: string): number =>
    stack.findIndex((e) => e.runId === runId && e.laneKey === laneKey);

  return {
    open(runId: string, laneKey: string): void {
      const idx = find(runId, laneKey);
      if (idx >= 0) {
        // 已开：重挂末尾=置顶（demo L2852 语义），零通道调用（openViewer 恰一次）
        const [entry] = stack.splice(idx, 1);
        stack.push(entry!);
        notify();
        return;
      }
      stack.push({ runId, laneKey });
      notify();
      void channels.openViewer({ runId, laneKey }).catch(() => {
        // 打开失败（CDP-SESSION-NOT-FOUND 等）：撤面板项（会话本身不动——错误处理归调用方日志面）
        const i = find(runId, laneKey);
        if (i >= 0) {
          stack.splice(i, 1);
          notify();
        }
      });
    },
    close(runId: string, laneKey: string): void {
      const idx = find(runId, laneKey);
      if (idx < 0) return;
      stack.splice(idx, 1);
      notify();
    },
    entries(): ViewerEntry[] {
      return stack.map((e) => ({ ...e }));
    },
    onChange(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** 查看窗面板 props（挂载=P5 应用壳 dock 点击接线：onOpenSession=(k)=>viewer.open(runId,k)） */
export interface SessionViewerPanelProps {
  viewer: SessionViewerController;
  model: CdpSessionsModel;
}

/** 全屏查看窗面板（每已开会话一枚 overlay：头部 label＋:port＋✕/URL 条/页面区——demo L2853-2868） */
export function SessionViewerPanel({ viewer, model }: SessionViewerPanelProps) {
  const [, setTick] = useState(0);
  useEffect(() => viewer.onChange(() => setTick((t) => t + 1)), [viewer]);
  useEffect(() => model.onChange(() => setTick((t) => t + 1)), [model]);

  const entries = viewer.entries();
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map((e) => {
        const session = model.sessionsOf(e.runId).find((s) => s.laneKey === e.laneKey);
        const label = session?.label ?? e.laneKey;
        const port = session?.port ?? 0;
        const url = session?.url ?? '';
        return (
          <div
            key={`${e.runId}/${e.laneKey}`}
            data-viewer={e.laneKey}
            className="fixed inset-0 z-50 flex flex-col rounded-md border border-[var(--line-2)] bg-[rgba(7,12,25,0.97)]"
          >
            <div
              data-viewer-head
              className="flex items-center gap-2 border-b border-[var(--line-2)] px-4 py-2 text-sm text-[var(--tx)]"
            >
              <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--accent)]" />
              <b data-lane="label" className="font-semibold">
                {label}
              </b>
              <span className="font-mono text-xs text-[var(--tx-2)]">:{port}</span>
              <div className="flex-1" />
              <button
                type="button"
                data-viewer-close
                title="关闭窗口（分支会话继续运行）"
                className="rounded px-2 py-0.5 text-sm text-[var(--tx-2)] hover:bg-[var(--accent-tint)] hover:text-[var(--tx)]"
                onClick={() => viewer.close(e.runId, e.laneKey)}
              >
                ✕
              </button>
            </div>
            <div data-viewer-url className="border-b border-[var(--line)] px-4 py-1 font-mono text-xs text-[var(--tx-3)]">
              {url}
            </div>
            <div data-viewer-page className="flex flex-1 flex-col items-center justify-center gap-3">
              <div className="text-lg text-[var(--tx-2)]">{stripUrlProtocol(url).split('/')[0] || 'localhost'}</div>
              <div className="h-2 w-56 rounded bg-[var(--line-2)]" />
              <div className="h-2 w-40 rounded bg-[var(--line)]" />
              <div className="h-2 w-28 rounded bg-[var(--line)]" />
            </div>
          </div>
        );
      })}
    </>
  );
}

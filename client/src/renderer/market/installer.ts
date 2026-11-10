// Installer —— 安装编排（T5-10 / TDD-C-09 §3 Installer 行）。
//
// 序（03 §1 install 行）：InstallConfirm（12.2#2——框1 detail 面，确认前零下载零导入零计量）
// →download（302 预签名 GET——client.request 大 timeoutMs〔S-05 §1 300s 对齐——评审转交项；
// T5-09 download(id) 面只读无超时位，经公开 request 面传大超时，⚠ 报告冻结〕）→C-08 导入链
// （PM 裁决 02 v1.0e：download 字节直入 importArchiveBytes——框2 confirm 注入=同一 InstallConfirm）
// →POST installs 计量（幂等 userId+packageId+day——S-02；尽力语义：失败不回滚安装）。
// kind 三分支：node→节点库（单条）、pack→整包批量入库（demo L3049-3058）、flow→FlowInstaller
// （inspectBytes→框2→commitBytes 资产落盘→steps 回放落新流程——不走 node/pack 全链）。
// UNAUTHORIZED（未登录前置拦截/登录态过期）→onUnauthorized 登录引导（LoginDialog 复用——装配注入）。
import type { PackageDetail, PermLabel } from '@constella/shared/dto';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { FlowSteps, PackageKind } from '@constella/shared/manifest';
import type {
  ImportArchiveOpts,
  ImportInspectOutcome,
  ImportResult,
  ImportSummary,
} from '../zip/import-orchestrator';
import { ImportCancelledError } from '../zip/import-orchestrator';
import type { FlowInstallResult } from './flow-installer';
import { confirmDataFromDetail, confirmDataFromSummary, type InstallConfirmData } from './install-confirm';
import type { MarketRequestInit, MarketDownloadResult } from './market-api-client';
import { isMarketApiError, isMarketUnauthorizedError } from './market-error';

/** download 大超时（S-05 §1① 预签名 GET TTL 300s 对齐——评审转交：调用传大 timeoutMs） */
export const MARKET_DOWNLOAD_TIMEOUT_MS = 300_000;

/** 安装引用（03 §1 install(ref) 入参形） */
export interface InstallRef {
  id: string;
  kind: PackageKind;
}

/** 安装结果（03 §1 InstallResult——X-01 未落 dto，本卡冻结形 ⚠：nodeCount=node/pack 入库数；
 *  flowId/edgeCount=flow 分支（flows.create 库 id／回放边数） */
export interface InstallResult {
  kind: PackageKind;
  nodeCount: number;
  flowId?: string;
  edgeCount?: number;
}

/** client 注入面（MarketApiClient 结构子集——request 供 download 大 timeoutMs） */
export interface MarketClientInstallFace {
  detail(id: string): Promise<PackageDetail>;
  request<T>(path: string, init?: MarketRequestInit): Promise<T>;
  recordInstall(id: string): Promise<{ ok: boolean }>;
}

/** C-08 导入链注入面（ImportOrchestrator 结构子集——bytes 链三面，02 v1.0e） */
export interface InstallerImporterFace {
  importArchiveBytes(bytes: Uint8Array, opts?: ImportArchiveOpts): Promise<ImportResult>;
  inspectBytes(bytes: Uint8Array): Promise<ImportInspectOutcome>;
  commitBytes(bytes: Uint8Array, token: string, defs?: ReadonlyArray<NodeDefinition>): Promise<ImportResult>;
}

/** FlowInstaller 注入面（§3 组件级接口 installFlow＋opts=noScript 回标〔T5-11 卡内冻结形〕） */
export interface InstallerFlowFace {
  installFlow(steps: FlowSteps, name: string, opts?: { noScriptNames?: readonly string[] }): Promise<FlowInstallResult>;
}

export interface InstallerDeps {
  client: MarketClientInstallFace;
  importer: InstallerImporterFace;
  flowInstaller: InstallerFlowFace;
  /** InstallConfirm 命令式封装注入（组件装配在应用壳——两拦截点共用一框） */
  confirm(data: InstallConfirmData): Promise<boolean>;
  /** perms 同源推导（C-05 PermDeriver 同源——框2 数据；与 importer 的 derivePerms 同装配注入） */
  derivePerms?(categories: readonly string[]): PermLabel[];
  notify(level: 'info' | 'ok' | 'warn' | 'err', msg: string): void;
  /** 登录引导（LoginDialog 打开——UNAUTHORIZED 捕获面；装配位注入） */
  onUnauthorized?(): void;
  log?: (...args: unknown[]) => void;
}

export interface Installer {
  install(ref: InstallRef): Promise<InstallResult>;
}

/** summary.nodes 元素运行时形（C-08 ParsedSummaryNode——FlowSteps 三元组提取源） */
interface SummaryNodeLike {
  type?: string;
  name?: string;
  params?: Record<string, unknown>;
  definition?: NodeDefinition;
}

function isUnauthorized(e: unknown): boolean {
  return isMarketUnauthorizedError(e) || (isMarketApiError(e) && e.code === 'UNAUTHORIZED');
}

export function createInstaller(deps: InstallerDeps): Installer {
  /** download：302 预签名 GET（fetch follow）→字节体（大 timeoutMs——评审转交项） */
  async function downloadBytes(id: string): Promise<Uint8Array> {
    const r = await deps.client.request<MarketDownloadResult>(
      `/api/market/packages/${encodeURIComponent(id)}/download`,
      { auth: true, method: 'GET', raw: 'bytes', timeoutMs: MARKET_DOWNLOAD_TIMEOUT_MS },
    );
    return r.data;
  }

  /** 框2（导入链/flow inspect 后）：summary→InstallConfirmData（perms 同源推导＋market 来源标记） */
  const confirmSummary = (detail: PackageDetail) => async (summary: ImportSummary): Promise<boolean> =>
    deps.confirm(
      confirmDataFromSummary(summary, {
        perms: deps.derivePerms?.(summary.categories) ?? [],
        author: `@${detail.author.name}`,
        source: 'market',
        trusted: true,
      }),
    );

  return {
    async install(ref) {
      try {
        // ———— ① detail（匿名）——框1 数据源 ————
        const detail = await deps.client.detail(ref.id);

        // ———— ② 框1：InstallConfirm（12.2#2——确认前零下载零导入零计量）————
        if (!(await deps.confirm(confirmDataFromDetail(detail)))) {
          throw new ImportCancelledError();
        }

        // ———— ③ download（大 timeoutMs）→ ④ kind 三分支 ————
        const bytes = await downloadBytes(ref.id);
        let result: InstallResult;
        if (ref.kind === 'flow') {
          // flow：inspect（安全校验＋C-02）→框2（同一框，精确清单）→commit（资产落盘＋register）
          // →FlowInstaller（steps 回放→flows.create→切换）；不走 node/pack 全链（不落当前画布）
          const { summary, token } = await deps.importer.inspectBytes(bytes);
          if (!(await confirmSummary(detail)(summary))) {
            throw new ImportCancelledError();
          }
          const defs: NodeDefinition[] = [];
          const seenTypes = new Set<string>();
          for (const raw of summary.nodes) {
            const n = raw as SummaryNodeLike;
            if (n?.definition === undefined || n.definition === null) continue;
            if (seenTypes.has(n.definition.type)) continue;
            seenTypes.add(n.definition.type);
            defs.push(n.definition);
          }
          await deps.importer.commitBytes(bytes, token, defs);
          const steps: FlowSteps = (summary.nodes as SummaryNodeLike[]).map((n) => [
            String(n?.type ?? ''),
            typeof n?.name === 'string' && n.name !== '' ? n.name : String(n?.type ?? ''),
            { ...(n?.params ?? {}) },
          ]);
          // noScript 回标（T5-10 🟡1→T5-11 硬接线 3）：Installer 持 summary.noScript——经
          // installFlow opts 随创建回标实例（卡内冻结形 ⚠——store patch 之外的可选路径）
          const flow = await deps.flowInstaller.installFlow(steps, detail.name, { noScriptNames: summary.noScript });
          result = { kind: 'flow', nodeCount: flow.nodeCount, edgeCount: flow.edgeCount, flowId: flow.flowId };
        } else {
          // node/pack：bytes 直入导入链全链（框2 confirm 注入=同一 InstallConfirm；node 单条
          // 入库、pack 整包批量——demo L3049-3058 语义在 C-08 链内落库）
          const res = await deps.importer.importArchiveBytes(bytes, {
            source: 'user',
            confirm: confirmSummary(detail),
          });
          result = { kind: ref.kind, nodeCount: res.nodes.length };
        }

        // ———— ⑤ installs 计量（幂等 userId+packageId+day——S-02；尽力：失败不回滚安装）————
        try {
          await deps.client.recordInstall(ref.id);
        } catch (err) {
          deps.notify('warn', '安装计量上报失败（不影响安装结果）');
          deps.log?.(`[market] installs 计量失败 pkg=${ref.id}:`, err);
        }

        // ———— ⑥ toast（demo L3049-3058）————
        deps.notify(
          'ok',
          result.kind === 'flow'
            ? `流程「${detail.name}」已安装`
            : `「${detail.name}」已装进节点库（${result.nodeCount} 个节点）`,
        );
        return result;
      } catch (err) {
        if (isUnauthorized(err)) {
          deps.notify('err', '登录后才能安装——请先登录');
          deps.onUnauthorized?.(); // 登录引导（LoginDialog——装配位注入）
        }
        throw err;
      }
    },
  };
}

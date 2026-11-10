// InstallConfirm —— 安装确认弹窗（T5-10 / TDD-C-09 §3 InstallConfirm 行）。
//
// 02 §12.2#2 拦截点组件（01 §8.2#② 逐项）：节点清单＋脚本清单＋权限标签（PermLabel）＋作者/来源＋
// 「将执行本机脚本」明示；noScript 包明示不可运行；来源不可信（未知作者/本地 zip 导入）加强提示。
// **两拦截点共用一框**（03 §2 ↑被依赖：C-08 导入链装配点注入复用）：
//   - 框1（market 安装）：Installer 链首——数据=confirmDataFromDetail(detail)（包级元数据；
//     节点/脚本清单未知——下载校验后框2 精确呈现）；
//   - 框2（导入链 confirm 注入）：importArchiveBytes({confirm})/flow 链 inspect 后——数据=
//     confirmDataFromSummary(summary)（inspect 精确清单）。
// 纯展示组件（LoginDialog 同模式）：busy/onConfirm/onCancel；命令式 confirm(data):Promise<boolean>
// 装配（弹窗开关与 Promise 归宿）在应用壳/T5-11 E2E 装配位。
import type { PackageDetail, PermLabel } from '@constella/shared/dto';
import type { PackageKind } from '@constella/shared/manifest';
import type { ImportSummary } from '../zip/import-orchestrator';

/** 节点清单条目（§3 行「节点清单」元素——hasScript=脚本映射命中且包内实况存在） */
export interface InstallConfirmNode {
  type: string;
  name: string;
  hasScript: boolean;
}

/** 归一确认数据形（框1/框2 共用一框的渲染源——两映射工厂产出；签名冻结 ⚠ T5-10） */
export interface InstallConfirmData {
  kind: PackageKind;
  name: string;
  summary?: string;
  version: string;
  /** 作者呈现（"@yeager"；本地导入无作者=空串） */
  author: string;
  /** 来源标签（'market'=广场（经审核）；'zip'=本地文件导入） */
  source: 'market' | 'zip';
  /** 来源可信（market=S-03 审核通道；不可信→加强提示条，01 §8.2#②） */
  trusted: boolean;
  perms: PermLabel[];
  /** 节点清单（框1 未知=空数组——占位说明「下载校验后展示」） */
  nodes: readonly InstallConfirmNode[];
  /** 无脚本节点点名（明示「不可运行」） */
  noScript: readonly string[];
  /** 脚本清单（manifest.scripts 文件名） */
  scriptFiles: readonly string[];
}

/** 框1（market 安装链首）：detail 面——匿名详情即确认框数据源（确认前零下载零导入零计量） */
export function confirmDataFromDetail(detail: PackageDetail): InstallConfirmData {
  return {
    kind: detail.kind,
    name: detail.name,
    ...(detail.summary !== undefined ? { summary: detail.summary } : {}),
    version: detail.version,
    author: `@${detail.author.name}`,
    source: 'market',
    trusted: true, // server 审核通道（S-03 状态机；未审核包不可下载——02 §12.4）
    perms: [...detail.perms],
    nodes: [], // 包内容清单下载校验后（框2）精确呈现
    noScript: [],
    scriptFiles: [],
  };
}

/** 框2（导入链 confirm 注入／flow 链 inspect 后）：summary 面——inspect 精确清单 */
export function confirmDataFromSummary(
  summary: ImportSummary,
  extras: { perms?: PermLabel[]; author?: string; source?: 'market' | 'zip'; trusted?: boolean } = {},
): InstallConfirmData {
  const noScript = [...summary.noScript];
  return {
    kind: summary.manifest.kind,
    name: summary.manifest.name,
    ...(summary.manifest.summary !== undefined ? { summary: summary.manifest.summary } : {}),
    version: summary.manifest.version,
    author: extras.author ?? '',
    source: extras.source ?? 'zip',
    trusted: extras.trusted ?? false, // 缺省本地导入=不可信（加强提示输入——01 §8.2#②）
    perms: [...(extras.perms ?? [])],
    nodes: summary.nodes.map((raw) => {
      const n = raw as { type?: string; name?: string };
      const name = typeof n?.name === 'string' && n.name !== '' ? n.name : String(n?.type ?? '');
      return { type: String(n?.type ?? ''), name, hasScript: !noScript.includes(name) };
    }),
    noScript,
    scriptFiles: Object.values(summary.manifest.scripts ?? {}).map((r) => r.file),
  };
}

export interface InstallConfirmProps {
  data: InstallConfirmData;
  /** 提交中（禁用确认钮） */
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

const KIND_LABEL: Readonly<Record<PackageKind, string>> = { node: '节点', pack: '节点包', flow: '流程' };

export function InstallConfirm({ data, busy = false, onConfirm, onCancel }: InstallConfirmProps) {
  // 「将执行本机脚本」明示条件：脚本清单非空（zip 内含 scripts/ 资产）
  const runsLocalScript = data.scriptFiles.length > 0;
  return (
    <div
      data-ic="root"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(3,6,16,0.72)]"
    >
      <div
        data-ic="panel"
        className="flex max-h-[80vh] w-[26rem] flex-col gap-3 overflow-y-auto rounded-lg border border-[var(--line-2)] bg-[rgba(9,14,28,0.96)] p-4 shadow-2xl"
      >
        <div className="flex items-baseline justify-between gap-2">
          <b className="text-sm font-semibold text-[var(--tx)]">安装确认</b>
          <span className="text-xs text-[var(--tx-2)]">
            {KIND_LABEL[data.kind]} · {data.name} · v{data.version}
          </span>
        </div>

        {/* 作者/来源（§3 行逐项） */}
        <p data-ic="origin" className="text-xs text-[var(--tx-2)]">
          作者：{data.author === '' ? '（未知作者）' : data.author}　来源：
          {data.source === 'market' ? '广场（经审核）' : '本地文件导入'}
        </p>
        {data.summary !== undefined && data.summary !== '' && (
          <p className="text-xs text-[var(--tx-2)]">{data.summary}</p>
        )}

        {/* 来源不可信加强提示（01 §8.2#②——未知作者/本地导入） */}
        {!data.trusted && (
          <p
            data-ic="untrusted"
            className="rounded bg-[rgba(120,20,40,0.25)] px-2 py-1 text-xs text-[#ff9db0]"
          >
            ⚠ 来源不可信（未知作者）——包内脚本将在本机执行，请确认来源后再安装
          </p>
        )}

        {/* 权限标签（PermLabel；空=「无特殊权限」——demo L2908 同构） */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-[var(--tx-2)]">权限：</span>
          {data.perms.length === 0 ? (
            <span className="text-xs text-[var(--tx-2)]">无特殊权限</span>
          ) : (
            data.perms.map((p) => (
              <span key={p} data-ic="perm" className="rounded bg-[var(--accent-tint)] px-1.5 py-0.5 text-xs text-[var(--accent-hi)]">
                {p}
              </span>
            ))
          )}
        </div>

        {/* 节点清单（框1 未知→占位说明） */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-[var(--tx)]">节点清单（{data.nodes.length}）</span>
          {data.nodes.length === 0 ? (
            <span className="text-xs text-[var(--tx-2)]">包内容清单在下载校验后展示（下一步确认）</span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {data.nodes.map((n) => (
                <li key={`${n.type}/${n.name}`} className="flex items-center justify-between text-xs text-[var(--tx-2)]">
                  <span>
                    {n.name}（{n.type}）
                  </span>
                  <span>{n.hasScript ? '📜 含脚本' : '⚠ 缺脚本'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 脚本清单（manifest.scripts 文件名） */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-[var(--tx)]">脚本清单（{data.scriptFiles.length}）</span>
          {data.scriptFiles.length === 0 ? (
            <span className="text-xs text-[var(--tx-2)]">无</span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {data.scriptFiles.map((f) => (
                <li key={f} className="text-xs text-[var(--tx-2)]">
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 「将执行本机脚本」明示（02 §12.2#2）＋noScript 不可运行明示 */}
        {runsLocalScript && (
          <p data-ic="run-script" className="rounded bg-[rgba(191,120,10,0.18)] px-2 py-1 text-xs text-[#ffcf8d]">
            ⚠ 将执行本机脚本——安装并运行即代表信任该来源
          </p>
        )}
        {data.noScript.length > 0 && (
          <p data-ic="noscript" className="rounded bg-[rgba(120,20,40,0.25)] px-2 py-1 text-xs text-[#ff9db0]">
            ⚠ {data.noScript.length} 个节点缺脚本（{data.noScript.join('、')}）——这些节点无法运行（强节点没有脚本走不了）
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            data-ic="cancel"
            className="rounded-md border border-[var(--line-2)] px-3 py-1.5 text-sm text-[var(--tx-2)] hover:bg-[var(--accent-tint)]"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            data-ic="confirm"
            disabled={busy}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[#04101f] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onConfirm}
          >
            {busy ? '安装中…' : '确认安装'}
          </button>
        </div>
      </div>
    </div>
  );
}

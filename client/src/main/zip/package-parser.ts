// PackageParser —— zip 资产包解析器（T5-07 / TDD-C-08 §3 PackageParser 组件行）。
//
// 职责（§3 组件行）：manifest 解析（源型=X-01 PackageManifest——顶层形已过 ZipSecurityValidator，
// 此处做 scripts 映射值形细校验）＋nodes/*.json 解析＋scripts 映射核对＋noScript 判定
// （manifest.scripts＋包内实况——demo L2626-2630 hasFile 同构）＋未知 type 兜底 data.transform
// 标记（demo L2623）。
//
// scripts 映射核对按 type 消歧（T5-06 评审转交）：流程变体 manifest.scripts 键=节点名、发布
// 变体键=类型（export-pipeline 两变体口径）——同名节点不同 custom 型时，映射值 file 须与该节点
// definition.exec.file 一致才认（导出侧 scriptsMap 同名覆盖边角的导入侧防线）。
//
// 未知 type 兜底（demo L2623 语义）：type 不在已知集（注入 hasType——生产=BUILTIN_TYPE_IDS ∪
// definitions DAO loadAll）且无 definition 随包 → 替换 data.transform＋warn 点名；有 definition
// 随包=新类型（定义将入库）不兜底。撞内置命名空间拒入不在此处（归 renderer validateDefinition
// ——02 §12.4 伪装类型拦截，ImportOrchestrator 注入调用）。
import { IPC_ERROR_CODES } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { PackageManifest, ScriptRef } from '@constella/shared/manifest';
import { ZipError } from '../storage-bridge/zip-channels';
import { decodeUtf8 } from './zip-security-validator';

/** 兜底类型（demo L2623：TYPES[d.type]?d.type:'data.transform'——内置 12 之一） */
export const FALLBACK_TYPE = 'data.transform';

/** 解析产物节点（summary.nodes 元素原始形——renderer 侧未知形消费） */
export interface ParsedNode {
  /** 未知型已兜底替换（originalType 留痕） */
  type: string;
  name: string;
  position: { x: number; y: number };
  params: Record<string, unknown>;
  /** custom 定义随包（发布变体恒在；流程变体 custom 在——export-pipeline 口径） */
  definition?: NodeDefinition;
  /** manifest.scripts 命中且包内实况存在的脚本引用（映射核对后） */
  scriptRef?: ScriptRef;
  /** 强节点缺脚本（manifest 无映射/映射不符/包内缺文件）——02 §8.4 noScript */
  noScript: boolean;
  /** 兜底前原 type（warn 点名/审计面） */
  originalType?: string;
}

export interface ParsedPackage {
  manifest: PackageManifest;
  nodes: ParsedNode[];
  /** 缺 scripts 节点点名（name——demo L2637 warn 面） */
  noScript: string[];
  /** custom 定义 meta.category 去重保序（perms 推导输入——X-01 ImportSummary.categories） */
  categories: string[];
  /** 待 upsert 定义集（custom、按包内首现序去重） */
  definitions: NodeDefinition[];
}

export interface PackageParserDeps {
  /** 已知类型面（生产=BUILTIN_TYPE_IDS ∪ definitions DAO loadAll 投影——main 内直调） */
  hasType(type: string): boolean;
  log?: (...args: unknown[]) => void;
}

export interface PackageParser {
  /** §3 冻结组件级接口：parse(entries)——manifest＋nodes 解析/映射核对/noScript 判定/兜底标记 */
  parse(entries: Map<string, Uint8Array>): ParsedPackage;
}

const NODES_PATTERN = /^nodes\/.+\.json$/;

interface RawNodeEntry {
  type?: unknown;
  name?: unknown;
  position?: unknown;
  params?: unknown;
  definition?: unknown;
}

function invalid(message: string): never {
  throw new ZipError(IPC_ERROR_CODES.ZIP_INVALID, message);
}

function parseScriptsMap(raw: PackageManifest['scripts']): Record<string, ScriptRef> {
  const out: Record<string, ScriptRef> = {};
  for (const [node, ref] of Object.entries(raw ?? {})) {
    const r = ref as unknown as Record<string, unknown>;
    if (
      typeof r?.file !== 'string' ||
      r.file === '' ||
      (r?.lang !== 'python' && r?.lang !== 'ts') ||
      typeof r?.entry !== 'string' ||
      r.entry === ''
    ) {
      invalid(`manifest.scripts[${node}] 值形不符（须 {file,lang:'python'|'ts',entry}——X-01 ScriptRef）`);
    }
    out[node] = { file: r.file as string, lang: r.lang as 'python' | 'ts', entry: r.entry as string };
  }
  return out;
}

export function createPackageParser(deps: PackageParserDeps): PackageParser {
  return {
    parse(entries) {
      const manifest: PackageManifest = JSON.parse(decodeUtf8(entries.get('manifest.json')!)); // 顶层形已过 validator
      const scriptsMap = parseScriptsMap(manifest.scripts);

      const nodeNames = [...entries.keys()].filter((k) => NODES_PATTERN.test(k)).sort();
      if (nodeNames.length === 0) invalid('包内没有 nodes/*.json（demo L2617）');

      const nodes: ParsedNode[] = [];
      const noScript: string[] = [];
      const categories: string[] = [];
      const definitions: NodeDefinition[] = [];
      const seenTypes = new Set<string>();

      for (const name of nodeNames) {
        let raw: RawNodeEntry;
        try {
          raw = JSON.parse(decodeUtf8(entries.get(name)!)) as RawNodeEntry;
        } catch (err) {
          invalid(`条目 ${name} 非法 JSON：${err instanceof Error ? err.message : String(err)}`);
        }
        if (typeof raw.type !== 'string' || raw.type === '') invalid(`条目 ${name} 缺 type（四件套 nodes/*.json 形）`);
        const definition =
          raw.definition !== undefined && raw.definition !== null ? (raw.definition as NodeDefinition) : undefined;

        // 未知 type 兜底（demo L2623）：不在已知集且无 definition 随包 → data.transform＋点名
        let type = raw.type;
        let originalType: string | undefined;
        if (!deps.hasType(type) && definition === undefined) {
          originalType = type;
          type = FALLBACK_TYPE;
          deps.log?.(`[zip] 未知节点类型 ${originalType} → 兜底 ${FALLBACK_TYPE}（demo L2623）`);
        }

        // scripts 映射核对（type 消歧）：发布变体键=type 直映；流程变体键=节点名＋file 与
        // definition.exec.file 一致性校验（T5-06 评审转交——同名不同型覆盖边角）
        const def = definition;
        let scriptRef: ScriptRef | undefined;
        const byType = scriptsMap[type];
        const byName = raw.name !== undefined && typeof raw.name === 'string' ? scriptsMap[raw.name] : undefined;
        const candidate = byType ?? byName;
        if (candidate !== undefined && def?.exec !== null && def?.exec !== undefined) {
          if (candidate.file === def.exec.file) scriptRef = candidate; // 消歧通过
        }

        // noScript 判定（manifest.scripts＋包内实况）：custom 强节点（exec≠null）缺脚本 → 标记
        const isCustomStrong = def !== undefined && def.kind === 'custom' && def.exec !== null;
        const hasScript = scriptRef !== undefined && entries.has(scriptRef.file);
        const nodeNoScript = isCustomStrong && !hasScript;

        const nodeName = typeof raw.name === 'string' && raw.name !== '' ? raw.name : type;
        const pos =
          raw.position !== undefined && typeof raw.position === 'object' && raw.position !== null
            ? (raw.position as { x: number; y: number })
            : { x: 0, y: 0 };
        nodes.push({
          type,
          name: nodeName,
          position: { x: typeof pos.x === 'number' ? pos.x : 0, y: typeof pos.y === 'number' ? pos.y : 0 },
          params:
            raw.params !== undefined && typeof raw.params === 'object' && raw.params !== null
              ? (raw.params as Record<string, unknown>)
              : {},
          ...(definition !== undefined ? { definition } : {}),
          ...(scriptRef !== undefined && hasScript ? { scriptRef } : {}),
          noScript: nodeNoScript,
          ...(originalType !== undefined ? { originalType } : {}),
        });
        if (nodeNoScript) noScript.push(nodeName); // 点名（demo L2637）

        // categories（custom 定义类目——perms 推导输入）＋definitions（custom 待 upsert）
        if (def !== undefined && def.kind === 'custom') {
          if (!categories.includes(def.meta.category)) categories.push(def.meta.category);
          if (!seenTypes.has(def.type)) {
            seenTypes.add(def.type);
            definitions.push(def);
          }
        }
      }

      return { manifest, nodes, noScript, categories, definitions };
    },
  };
}

// zip 资产包 manifest 形（X-01 §1 manifest 行；02 §3.2 C-08 行、§6.2、§8.4；01 A-4.03）。
// zip 四件套＝manifest.json + nodes/ + scripts/ + config/ + deps/（02 §8.4；demo L941-945 参照非权威）；
// 本形＝manifest.json 主体：scripts 映射 node→{file,lang,entry} + 导出元信息 kind/name/summary/version。
// 存档位：client asset_packages.manifest 与 server PackageVersion.manifest（02 §7.1/§7.2 原文存档）；
// server 解析 manifest 推导 perms（02 §6.2 发布处理序）；安全校验 JSON Schema 源型（C-08 §1 #4）。
// 注意：lang 字面量与 N4 ExecSpec（'python'|'ts'）一致；IPC run:spawnScript 的 lang 是 'py'|'ts'
// （02 §3.4 原文），两处字面量不同源、均按各自锚冻结。
export type PackageKind = 'node' | 'pack' | 'flow';

/** scripts 映射值：node → 脚本资产引用（X-01 §1 manifest 行「node→{file,lang,entry}」） */
export interface ScriptRef {
  /** 脚本文件（zip 包内相对路径，如 "scripts/xhs_search.py"） */
  file: string;
  /** 脚本语言（与 N4 ExecSpec.lang 同字面量） */
  lang: 'python' | 'ts';
  /** 入口函数名 */
  entry: string;
}

export interface PackageManifest {
  /** 资产类别（node 单类型 / pack 节点集 / flow 流程；02 §6.2 market kind 同字面量） */
  kind: PackageKind;
  /** 包名 */
  name: string;
  /** 摘要（可缺） */
  summary?: string;
  /** 包 semver（D-11 ⚠：首发 v1.0.0、V1 单版本覆盖更新） */
  version: string;
  /** 脚本资产映射（kind=flow 或无脚本包可缺） */
  scripts?: Record<string, ScriptRef>;
}

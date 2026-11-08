// 节点定义 DSL 聚合根（X-01 §1 dsl 行；02 §8.1 N1~N8 全维度；02 §7.1 node_definitions 表列）。
// 列 ↔ DSL 键映射知识登记（X-01 §4）：meta/ports/params_schema/exec/inner/policy/io/version/pkg_version
// ↔ N1 meta/N2 ports/N3 paramsSchema/N4 exec/N5 inner/N6 policy/N7 io/N8 version+packageVersion；
// 行 ↔ 类型转换实现于 C-06 DAO。
// 注册表语义（02 §8.2）：NodeRegistry = Map<type, NodeDefinition>；内置 12 类与 custom 同一注册表、
// 无分支处理；校验本体归 C-02 validateDefinition（本包只冻结形）。
import type { ExecSpec } from './exec';
import type { IoContract } from './io';
import type { NodeMeta } from './meta';
import type { NodePorts } from './ports';
import type { ParamField } from './params';
import type { RunPolicy } from './policy';

/** builtin＝平台内置（✨ 角标=custom）；DDL CHECK(kind IN ('builtin','custom'))，02 §7.1 */
export type NodeKind = 'builtin' | 'custom';

/** N5 组合节点内嵌子步骤（02 §8.1「inner」：string[]，可展示；执行时引擎内联展开，02 §8.5） */
export type InnerStep = string;

export interface NodeDefinition {
  /** 类型 id（命名空间：custom 前缀不得撞内置 12 类，校验归 C-02；表 PK） */
  type: string;
  /** builtin | custom（✨ 角标判定） */
  kind: NodeKind;
  /** N1 元信息 */
  meta: NodeMeta;
  /** N2 端口 */
  ports: NodePorts;
  /** N3 参数表单 schema */
  paramsSchema: ParamField[];
  /** N4 执行体；null＝无脚本节点（noScript 判定输入，02 §8.4；DDL 列可空） */
  exec: ExecSpec | null;
  /** N5 组合节点子步骤（可缺；DDL 列可空） */
  inner?: readonly InnerStep[] | null;
  /** N6 运行策略（可缺；缺省默认 timeout 30s/retries 0/onFailure abort，02 §8.6） */
  policy?: RunPolicy | null;
  /** N7 IO 契约（可缺；DDL 列可空） */
  io?: IoContract | null;
  /** N8 节点 semver（DDL 默认 '1.0.0'） */
  version: string;
  /** N8 zip 包 semver（DDL 列 pkg_version，默认 '1.0.0'；D-11 ⚠） */
  packageVersion: string;
}

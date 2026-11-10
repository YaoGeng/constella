// N1 网络门（T5-12a / PM 缺省①锚冻结）——节点门判定纯函数：SandboxExecutor `netEndpointOf`
// 生产接线（T4-16 注入缝兑现）的判定本体。
//   门=N1 类目含「网络」（03 C-M1 §3 NetProxyBridge 行「绑定判据＝N1 权限类目含『网络』→
//   注入 CONSTELLA_NET_WS，否则 ctx.net＝未绑定 stub」；类目=N1 自由文本，X-01 dsl meta 行
//   「perms 推导与网格分组参照」）。
//   判定输入=req.scriptPath（node-types/<type>/<version>/… 布局首段=type——02 §12.2#3 资产
//   白名单根同源）＋定义表（生产装配经 C-06 definitions DAO main 内直调，§2）。
import path from 'node:path';
import type { NodeDefinition } from '@constella/shared/dsl';

/** 类目「网络」标记（自由文本含「网络」即门开——含复合类目如「网络·社媒」） */
export const NET_CATEGORY_MARK = '网络';

/** N1 类目门：类目自由文本含「网络」 */
export function isNetCategory(category: string): boolean {
  return category.includes(NET_CATEGORY_MARK);
}

/**
 * scriptPath → 节点 type 解析（node-types/<type>/<version>/… 首段；win32 大小写不敏感——
 * SandboxExecutor.resolveScriptPath 白名单同口径，越界/畸形=undefined）。
 */
export function nodeTypeOfScript(scriptPath: string, nodeTypesRoot: string): string | undefined {
  const base = nodeTypesRoot.endsWith(path.sep) ? nodeTypesRoot : nodeTypesRoot + path.sep;
  const abs = path.isAbsolute(scriptPath)
    ? path.normalize(scriptPath)
    : path.normalize(path.join(nodeTypesRoot, scriptPath));
  if (!abs.toLowerCase().startsWith(base.toLowerCase())) return undefined; // 越界（02 §12.2#3）
  const rel = path.relative(base, abs);
  if (rel === '' || rel.startsWith('..')) return undefined;
  const first = rel.split(path.sep)[0];
  return first === undefined || first === '' ? undefined : first;
}

/**
 * N1 网络门整判（host 供给面——production-assembly netEndpointOf 消费）：
 * type 解析 → 定义命中 → 类目含「网络」→ 返回命中定义；任一环不中=undefined（不注入 NET_WS）。
 */
export function netEligibleDefinition(
  scriptPath: string,
  nodeTypesRoot: string,
  defs: readonly NodeDefinition[],
): NodeDefinition | undefined {
  const type = nodeTypeOfScript(scriptPath, nodeTypesRoot);
  if (type === undefined) return undefined;
  return defs.find((d) => d.type === type && isNetCategory(d.meta.category));
}

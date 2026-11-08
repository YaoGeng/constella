// 权限标签常量（X-01 §1 constants 域文件树 perms.ts；标签类型形＝dto PermLabel）。
// 六标签封闭集合：CDP/网络/文件/AI/交互/社媒（02 §6.2/§12.2#1；01 §8.2①「按节点类目自动推导权限标签」；
// demo L2875-2880 pubPermsOf 类目→标签映射同源——映射本体归 C-05 PermDeriver，server 复核同源）。
import type { PermLabel } from '../dto/common';

/** 权限标签全集（常量形；类型形见 dto PermLabel） */
export const PERM_LABELS = ['CDP', '网络', '文件', 'AI', '交互', '社媒'] as const satisfies readonly PermLabel[];

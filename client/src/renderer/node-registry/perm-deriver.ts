// PermDeriver —— 类目→权限标签映射（C-05 §3 组件行；T1-11）。
//
// 映射同源：01 A-13.1 / demo L2875-2880 pubPermsOf——CDP/网络/AI/交互/社媒同名直映、
// 数据→文件、未命中类目不产生标签；kind=builtin 不计（「只选内置类型→无特殊权限」，
// demo L2908）。去重保序＝demo 语义（首现序）。
// 消费方：C-08 发布弹窗、C-09 安装确认；S-02 ManifestGuard（T2-06）server 复核同源映射。
// 扩展点（C-05 §8③）：新类目波次（如 V2.x「电脑」）追加表项即可——未命中不产生标签为默认行为。
import type { PermLabel } from '@constella/shared/dto';
import type { RegistryCore } from './registry-core';

/** 类目 → 权限标签（demo L2876 同源冻结；键＝meta.category 自由文本的非白名单投影） */
const CATEGORY_TO_PERM: Readonly<Record<string, PermLabel>> = {
  CDP: 'CDP',
  网络: '网络',
  数据: '文件',
  AI: 'AI',
  交互: '交互',
  社媒: '社媒',
};

export class PermDeriver {
  constructor(private readonly core: RegistryCore) {}

  /** 发布权限推导：逐 type 查注册表——未注册/builtin/未命中类目跳过；标签首现序去重 */
  derivePerms(types: readonly string[]): PermLabel[] {
    const out: PermLabel[] = [];
    for (const type of types) {
      const doc = this.core.get(type);
      if (doc === undefined || doc.kind === 'builtin') continue; // builtin 不计（01 A-13.1）
      const label = CATEGORY_TO_PERM[doc.meta.category];
      if (label !== undefined && !out.includes(label)) out.push(label);
    }
    return out;
  }
}

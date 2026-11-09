// NamespaceGuard —— N1 type 命名空间守卫（C-02 §3 组件行；T4-07；02 §8.1 校验规则#1）。
//
// 双查（05 卡原文：ctx.hasType＋X-01 BUILTIN_TYPE_IDS 双查）：
//   ① 静态＝BUILTIN_TYPE_IDS（12 内置——注册表未装载/编辑草稿期也拦得住，02 §12.4 伪装类型拦截行）；
//   ② 动态＝ctx.hasType（注册表查重——装载序/导入期对已注册类型的撞名判定）。
// 仅对 kind==='custom' 生效（builtin 定义天然持有内置 type——分支判定归 DefinitionValidator）；
// C-05 loadAll 注入路径＝无 ctx 单参调用（definition-loader 已冻结），此时仅静态查——
// 同名同型 upsert（A-11.1）不受动态查误伤。
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import type { FieldError, ValidateContext } from './types';

/** custom type 撞名检查（C-02 §3 组件级接口：checkNamespace(type,ctx)） */
export function checkNamespace(type: string, ctx?: ValidateContext): FieldError[] {
  if ((BUILTIN_TYPE_IDS as readonly string[]).includes(type)) {
    // 撞内置即终结（同因不叠加），动态查不再重复报
    return [
      {
        field: 'type',
        message: `custom type「${type}」撞内置类型（BUILTIN_TYPE_IDS 静态查，02 §12.4 伪装类型拦截）`,
        rule: 'N1-namespace',
      },
    ];
  }
  if (ctx?.hasType(type)) {
    return [
      {
        field: 'type',
        message: `custom type「${type}」与已注册类型撞名（ctx.hasType 动态查）`,
        rule: 'N1-namespace',
      },
    ];
  }
  return [];
}

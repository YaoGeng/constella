// ExecRefChecker —— N4 执行体形校验（C-02 §3 组件行；T4-07；02 §8.1 校验规则#4/§8.4）。
//
// exec 可缺＝noScript 判定输入（缺 scripts/ 的强节点标 no_script、运行闸拦截——01 A-12.3）：
// null/undefined 不产错——合法性归本组件、noScript 标记与资产存在性归 C-03 运行闸/zip 管线
// （file 指向的脚本落盘核对在 C-08 导入链，02 §8.4），本组件只校定义内形。
// 脏数据入口（AI 生成/zip 导入）在类型系统外构造，按运行时值判定。
import type { ExecSpec } from '@constella/shared/dsl';
import type { FieldError } from './types';

/** exec 形校验（C-02 §3 组件级接口：checkExec(exec)）——null/undefined → []（noScript 判定输入） */
export function checkExec(exec: ExecSpec | null | undefined): FieldError[] {
  if (exec == null) return [];
  const errors: FieldError[] = [];
  if (exec.lang !== 'python' && exec.lang !== 'ts') {
    errors.push({
      field: 'exec.lang',
      message: `exec.lang 须为 python|ts（当前「${String(exec.lang)}」）`,
      rule: 'N4-exec',
    });
  }
  if (typeof exec.file !== 'string' || exec.file.trim() === '') {
    errors.push({ field: 'exec.file', message: 'exec.file 不能为空（脚本路径）', rule: 'N4-exec' });
  }
  if (typeof exec.entry !== 'string' || exec.entry.trim() === '') {
    errors.push({ field: 'exec.entry', message: 'exec.entry 不能为空（入口函数名）', rule: 'N4-exec' });
  }
  return errors;
}

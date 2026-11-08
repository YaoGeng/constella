// N4 执行体（X-01 §1 dsl 行；02 §8.1「exec」/§8.4 脚本资产加载与沙箱执行衔接；01 A-4.03 契约）。
// exec 可缺＝无脚本节点（noScript 判定输入：缺 scripts/ 资产的强节点标 no_script，
// 运行闸拦截并警告，02 §8.4/01 A-12.3）——故 NodeDefinition.exec 为 ExecSpec | null。
export interface ExecSpec {
  /** 脚本语言（02 §8.1 校验规则：exec.lang ∈ {python, ts}） */
  lang: 'python' | 'ts';
  /** 脚本文件（zip 包内相对路径，如 "scripts/xhs_search.py"） */
  file: string;
  /** 入口函数名（如 "run"） */
  entry: string;
  /** 包级默认配置文件（config/*.yaml，02 §14 覆盖序中间层；可选） */
  config?: string;
  /** 依赖声明文件（deps/requirements.txt 等；可选） */
  deps?: string;
}

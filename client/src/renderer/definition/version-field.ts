// VersionField —— N8 semver 形状校验（C-02 §3 组件行；T4-07；02 §8.1 校验规则#8）。
//
// 形状＝MAJOR.MINOR.PATCH 三段非负整数、无前导 v（02 §8.1 示例 1.2.0/1.1.0、MA-5 minor
// 升级 v1.0.0→v1.1.0 语义值均为纯三段形）；首发 1.0.0 与单版本覆盖规则归发布侧（D-11/S-02）。
// 自拟收窄留痕：prerelease/build 后缀（如 1.0.0-beta）V1 不放行——锚文档无先例形态，
// 放宽不破既有定义（向后兼容），须随锚文档升版。
/** semver 三段形状（X.Y.Z，各段非负整数） */
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/** semver 形状判定（C-02 §3 组件级接口：checkSemver(v)）——纯谓词；
 * 错误包装（field=version|packageVersion）归 DefinitionValidator */
export function checkSemver(v: string): boolean {
  return SEMVER_RE.test(v);
}

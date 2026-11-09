// 场景 1（S-5 六形态之一，判据字面形态）：import { run } from '@constella/sdk' —— 值导入。
// SDK 参考实现 = identity：回传 { data: ctx.input }。
// （S-5 原型经 esbuild 打包执行；本包 fixtures 由契约测试以 node ≥23.6 原生
//   type-stripping 直跑——相对 import 需显式扩展名、JSON 需 import 属性，语义与 S-5 逐帧一致。）
import { run } from '@constella/sdk';

export { run };

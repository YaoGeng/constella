# 场景 1（S-5 六形态之一，判据字面形态）：from constella_sdk import run —— 值导入。
# SDK 参考实现 = identity：回传 { data: ctx.input }。
# （ts 对照物 sdk/fixtures/s1-basic.ts：`import { run } from '@constella/sdk'; export { run }`。）
from constella_sdk import run

__all__ = ["run"]

// 场景 6（S-5 六形态之一）：NodeOut 形状违规（既无 data 也无 branch）→ 必须走错误通道
// （code=OUT_INVALID, exit 1）而非静默成功。
import type { NodeCtx } from '@constella/sdk';

export async function run(_ctx: NodeCtx): Promise<unknown> {
  return { wrong: 1 };
}

// 场景 4（S-5 六形态之一）：错误抛出 —— 验证错误通道（stdout error 终帧 + exit 1，
// 宿主不依赖 stderr/退出码单通道）。
import type { NodeCtx, NodeOut } from '@constella/sdk';

export async function run(ctx: NodeCtx): Promise<NodeOut> {
  await ctx.sleep(5);
  ctx.log('about to fail');
  throw new Error(`boom: ${String(ctx.params.reason ?? 'unknown')}`);
}

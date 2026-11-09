// 场景 5（S-5 六形态之一）：{ branch } 路由交付 + ctx.emit 命令式分支发射（02 §14 NodeOut / demo L1019-1023）。
import type { NodeCtx, NodeOut } from '@constella/sdk';

export async function run(ctx: NodeCtx): Promise<NodeOut> {
  const n = Number(ctx.input ?? 0);
  if (n % 2 === 1) {
    await ctx.emit('odd', { n });
  }
  await ctx.sleep(5);
  return { branch: 'done', doubled: n * 2 };
}

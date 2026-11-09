// 场景 2（S-5 六形态之一，demo 契约主形态，02 §14 + demo L1032-1040）：
// PARAMS 默认值 ← ctx.params 覆盖；async/await + ctx.log/ctx.sleep。
import type { NodeCtx, NodeOut } from '@constella/sdk';

const PARAMS = { factor: 2, label: 'score' };

export async function run(ctx: NodeCtx): Promise<NodeOut> {
  const p = { ...PARAMS, ...(ctx.params || {}) };
  ctx.log(`factor=${p.factor}, input=${ctx.input}`);
  await ctx.sleep(10);
  const v = Number(ctx.input ?? 0) * p.factor;
  return { data: { [p.label]: v } };
}

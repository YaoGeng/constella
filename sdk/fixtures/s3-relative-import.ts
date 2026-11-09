// 场景 3（S-5 六形态之一）：外部相对 import（./lib/helper.ts + ./lib/items.json）
// + node 内建模块（node:crypto）——直跑形态下相对 import 带显式扩展名、
// JSON import 带 `with { type: 'json' }` 属性（esbuild 打包同样支持，T4-12 兼容）。
import { createHash } from 'node:crypto';
import type { NodeCtx, NodeOut } from '@constella/sdk';
import { normalize } from './lib/helper.ts';
import items from './lib/items.json' with { type: 'json' };

export async function run(ctx: NodeCtx): Promise<NodeOut> {
  const key = normalize(String(ctx.params.key ?? ' x '));
  const hash = createHash('sha256')
    .update(`${key}::${String(ctx.input)}`)
    .digest('hex')
    .slice(0, 12);
  return { data: { key, tags: items.tags.join('|'), hash } };
}

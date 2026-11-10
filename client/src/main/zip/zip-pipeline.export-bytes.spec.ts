// zip:export 字节双变体（✅ 02 v1.0f 勘误〔2026-11-10 PM 裁决，T5-11〕——`{flowId}` / `{types[],meta}`
// 无 savePath → {bytes,count,scripts,checksum}，不写盘；发布上传链 multipart 免文件读回）。
//
// 覆盖：
// - 流程字节变体：nodes/*.json **BFS 拓扑序**物化（FlowSteps 序列化语义，01 A-13.2——安装端
//   T5-10 已按此形冻结）；manifest kind='flow'＋scripts 键=节点名（v1.0f 勘误原文）；
// - 发布字节变体：与盘变体同装配（node 单类型/pack 多类型）；checksum=`sha256:<hex>`（server 幂等键对端）；
// - 确定性：同输入同产物字节（ZIP_EPOCH——checksum 真内容幂等键）；
// - 不写盘：产物目录零新增文件；
// - payload 校验面（T4-14 四变体收窄——validateInvokePayload 直调，v1.0e bytes spec 同手法）。
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { FlowDoc } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import { validateInvokePayload } from '../ipc/payload-schemas';
import { createZipExportPipeline } from './export-pipeline';

const tmp = mkdtempSync(path.join(tmpdir(), 'constella-zipexpb-'));
const outDir = path.join(tmp, 'out'); // 字节变体不应触盘的观测目录
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function put(rel: string, content: string): Promise<void> {
  const p = path.join(tmp, rel);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, content, 'utf8');
}

function defOf(partial: Partial<NodeDefinition> & Pick<NodeDefinition, 'type'>): NodeDefinition {
  return {
    kind: 'custom',
    meta: { name: partial.type, icon: '✨', category: '自定义' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
    ...partial,
  };
}

const DEFS: NodeDefinition[] = [
  defOf({
    type: 'xhs.search',
    meta: { name: '小红书搜索', icon: '📕', category: '社媒' },
    exec: { lang: 'python', file: 'scripts/xhs_search.py', entry: 'run' },
  }),
  defOf({
    type: 'ai.summarize',
    meta: { name: 'AI 摘要', icon: '🤖', category: 'AI' },
    exec: { lang: 'ts', file: 'scripts/summarize.ts', entry: 'run' },
  }),
];

/** 存储序=乱序（c→a→b）；BFS 期望序=a→b→c（边 a→b→c 线性链＋孤岛 a2 追加） */
const FLOW: FlowDoc = {
  id: 'f1',
  name: '小红书采集',
  nodes: [
    { id: 'c', type: 'ai.summarize', name: 'AI 摘要', position: { x: 400, y: 0 }, params: {} },
    { id: 'a', type: 'xhs.search', name: '小红书搜索', position: { x: 0, y: 0 }, params: {} },
    { id: 'b', type: 'xhs.search', name: '搜索二', position: { x: 200, y: 0 }, params: {} },
    { id: 'a2', type: 'ai.summarize', name: '孤岛摘要', position: { x: 0, y: 300 }, params: {} }, // 无边——存储序兜底段
  ],
  edges: [
    { id: 'e1', from: ['a', 'out'], to: ['b', 'in'] },
    { id: 'e2', from: ['b', 'out'], to: ['c', 'in'] },
  ],
};

async function makePipeline(): Promise<ReturnType<typeof createZipExportPipeline>> {
  await put(path.join('node-types', 'xhs.search', '1.0.0', 'scripts', 'xhs_search.py'), 'def run(ctx):\n    return {}\n');
  await put(path.join('node-types', 'ai.summarize', '1.0.0', 'scripts', 'summarize.ts'), 'export function run(ctx) { return {}; }\n');
  const defs = new Map(DEFS.map((d) => [d.type, d]));
  const flows = new Map<string, FlowDoc>([['f1', FLOW]]);
  return createZipExportPipeline({
    getFlow: (id) => flows.get(id),
    getDefinition: (type) => defs.get(type),
    nodeTypesRoot: path.join(tmp, 'node-types'),
  });
}

async function readEntries(bytes: Uint8Array): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out = new Map<string, string>();
  for (const [name, entry] of Object.entries(zip.files)) {
    out.set(name, await entry.async('string'));
  }
  return out;
}

describe('zip:export 字节变体——流程 `{flowId}`（BFS 拓扑序物化）', () => {
  it('nodes/*.json 按 BFS 拓扑序（根→沿边；孤岛存储序追加）；manifest kind=flow＋scripts 键=节点名', async () => {
    const pipeline = await makePipeline();
    const res = await pipeline({ flowId: 'f1' });
    expect('bytes' in res).toBe(true);
    if (!('bytes' in res)) throw new Error('unreachable');
    expect(res.count).toBe(4);
    expect(res.scripts.map((s) => s.lang).sort()).toEqual(['python', 'ts']);

    const entries = await readEntries(res.bytes);
    // BFS 物化序（中央目录条目序；demo L2947-2955 同构——根=全部无入边节点先入队，再沿边 BFS）：
    // 根集 [a, a2]（存储序）→ a 沿边展开 b→c；条目名=节点名 safeStem（demo L2579）
    const order = [...entries.keys()].filter((n) => n.startsWith('nodes/'));
    expect(order).toEqual([
      'nodes/小红书搜索.json', // a（根=无入边，存储序先）
      'nodes/孤岛摘要.json', // a2（同为根——根集按存储序先入队）
      'nodes/搜索二.json', // b（a→b）
      'nodes/AI 摘要.json', // c（b→c；与孤岛同 type 不同名各自成条）
    ]);

    const manifest = JSON.parse(entries.get('manifest.json')!);
    expect(manifest.kind).toBe('flow');
    expect(manifest.name).toBe('小红书采集');
    expect(manifest.version).toBe('1.0.0');
    // v1.0f：scripts 键=节点名；类型级脚本资产去重（同型首现节点登记——盘变体同源行为）
    expect(Object.keys(manifest.scripts).sort()).toEqual(['孤岛摘要', '小红书搜索']);
  });

  it('确定性＋checksum=sha256(bytes)（`sha256:<hex>`——server 幂等键对端）', async () => {
    const pipeline = await makePipeline();
    const r1 = await pipeline({ flowId: 'f1' });
    const r2 = await pipeline({ flowId: 'f1' });
    if (!('bytes' in r1) || !('bytes' in r2)) throw new Error('unreachable');
    expect(Buffer.from(r1.bytes).equals(Buffer.from(r2.bytes))).toBe(true);
    const hex = createHash('sha256').update(r1.bytes).digest('hex');
    expect(r1.checksum).toBe(`sha256:${hex}`);
    expect(r1.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('不写盘（产物目录零新增）＋空流程/缺流程拒绝同盘变体', async () => {
    const pipeline = await makePipeline();
    expect(existsSync(outDir)).toBe(false);
    await pipeline({ flowId: 'f1' });
    expect(existsSync(outDir)).toBe(false);
    expect(readdirSync(tmp).includes('out')).toBe(false);

    await expect(pipeline({ flowId: 'missing' })).rejects.toThrow(/流程不存在/);
    const emptyPipeline = createZipExportPipeline({
      getFlow: () => ({ id: 'e', name: '空', nodes: [], edges: [] }),
      getDefinition: () => undefined,
      nodeTypesRoot: tmp,
    });
    await expect(emptyPipeline({ flowId: 'e' })).rejects.toThrow(/当前流程没有节点可导出/);
  });
});

describe('zip:export 字节变体——发布 `{types[],meta}`（与盘变体同装配）', () => {
  it('单类型→manifest kind=node；多类型→pack；checksum=sha256(bytes)', async () => {
    const pipeline = await makePipeline();
    const node = await pipeline({ types: ['xhs.search'], meta: { name: '单节点包' } });
    if (!('bytes' in node)) throw new Error('unreachable');
    expect(node.count).toBe(1);
    const nodeEntries = await readEntries(node.bytes);
    expect(JSON.parse(nodeEntries.get('manifest.json')!).kind).toBe('node');
    expect(node.checksum).toBe(`sha256:${createHash('sha256').update(node.bytes).digest('hex')}`);

    const pack = await pipeline({ types: ['xhs.search', 'ai.summarize'], meta: { name: '双类型包' } });
    if (!('bytes' in pack)) throw new Error('unreachable');
    const packEntries = await readEntries(pack.bytes);
    expect(JSON.parse(packEntries.get('manifest.json')!).kind).toBe('pack');
    expect(pack.count).toBe(2);
    // deps 按语言（demo L2591-2592）：python＋ts 双语言齐备
    expect(packEntries.has('deps/requirements.txt')).toBe(true);
    expect(packEntries.has('deps/package.json')).toBe(true);
  });

  it('空勾选/未知类型拒绝（与盘变体同文案）', async () => {
    const pipeline = await makePipeline();
    await expect(pipeline({ types: [], meta: { name: '空' } })).rejects.toThrow(/未勾选任何节点类型/);
    await expect(pipeline({ types: ['nope.type'], meta: { name: 'X' } })).rejects.toThrow(/未知节点类型/);
  });
});

describe('payload 校验面（T4-14 四变体——vZipExport 收窄）', () => {
  it('字节双变体过校验；盘双变体原样；错形拒绝', () => {
    const ch = 'constella:zip:export';
    expect(validateInvokePayload(ch, { flowId: 'f1' }).ok).toBe(true);
    expect(validateInvokePayload(ch, { types: ['a'], meta: { name: 'n' } }).ok).toBe(true);
    expect(validateInvokePayload(ch, { flowId: 'f1', savePath: 'x.zip' }).ok).toBe(true);
    expect(validateInvokePayload(ch, { types: ['a'], savePath: 'x.zip', meta: { name: 'n' } }).ok).toBe(true);
    // 错形/缺字段
    expect(validateInvokePayload(ch, { flowId: '' }).ok).toBe(false);
    expect(validateInvokePayload(ch, { types: [], meta: {} }).ok).toBe(false);
    expect(validateInvokePayload(ch, { savePath: 'x.zip' }).ok).toBe(false);
    expect(validateInvokePayload(ch, {}).ok).toBe(false);
  });
});

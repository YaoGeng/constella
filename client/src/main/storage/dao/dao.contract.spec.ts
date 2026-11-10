// DAO 契约套件（T1-04/T1-05 验收；C-06 §6.3——双引擎同一契约套件、零 DAO 改动）。
// 覆盖：flows/versions/definitions/library（分组一）＋runs+nodeRuns/lanes/logs/settings/hits/
// assetPackages/pendingPublish（分组二）。行↔类型转换、soft_del 过滤、LIFO、同名同型、
// active-run 互斥、logs 滚动 20000、KV 形、hash 幂等。
import { describe, expect, it } from 'vitest';
import type { DbEngine } from '../engine/connection';
import { makeTempDb, TEST_ENGINES } from '../testing/harness';
import { StorageLayer } from '../storage-layer';
import { createStorageDao, type StorageDao } from './index';
import { SavePipeline } from '../save/save-pipeline';
import { LOGS_RETENTION_ROWS } from './logs-dao';
import type { FlowNode } from '@constella/shared/ipc';
import type { NodeOut } from '@constella/shared/dsl';
import type { NodeDefinition } from '@constella/shared/dsl';

interface Ctx {
  layer: StorageLayer;
  dao: StorageDao;
  save: SavePipeline;
}

function openCtx(engine: DbEngine, tmp: { dir: string }): Ctx {
  const layer = new StorageLayer(engine);
  layer.open(tmp.dir);
  const dao = createStorageDao(() => layer.connection);
  return { layer, dao, save: new SavePipeline(() => layer.connection) };
}

function flowNode(id: string, type: string, x = 10, y = 20): FlowNode {
  return { id, type, name: `节点-${id}`, position: { x, y }, params: { k: id } };
}

function customDef(type = 'custom.demo'): NodeDefinition {
  return {
    type,
    kind: 'custom',
    meta: { name: '演示节点', icon: '🧪', category: '数据', color: 'accent', author: '@yg', source: 'manual' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }, { id: 'err', label: '错误' }] },
    paramsSchema: [
      { k: 'url', t: 'text', required: true },
      { k: 'n', t: 'slider', min: 0, max: 100, step: 10 },
    ],
    exec: { lang: 'python', file: 'scripts/demo.py', entry: 'run' },
    inner: ['step1', 'step2'],
    policy: { timeoutMs: 5000, retries: 1, backoffMs: 200, onFailure: { type: 'failBranch', exit: 'err' } },
    io: { input: { fields: [{ name: 'q', type: 'string' }] }, output: { fields: [{ name: 'r', type: 'object[]' }] } },
    version: '1.2.3',
    packageVersion: '0.9.0',
  };
}

describe.each(TEST_ENGINES)('storage dao [%s]', (engine: DbEngine) => {
  it('flows：create 打初始版本 / list / rename / softDelete 过滤 / reorder / get 栈顶投影', () => {
    const tmp = makeTempDb();
    try {
      const { layer, dao } = openCtx(engine, tmp);
      const a = dao.flows.create('流程A');
      const b = dao.flows.create('流程B');
      expect(a.id).not.toBe(b.id);

      // open() 已种 9 条种子流程——列表=种子 9＋新建 2（新建排尾，order_idx=max+1）
      const createdOnly = (items: { id: string; name: string }[]): { id: string; name: string }[] =>
        items.filter((x) => x.id === a.id || x.id === b.id);
      let items = dao.flows.list().items;
      expect(items).toHaveLength(11);
      expect(createdOnly(items).map((x) => x.name)).toEqual(['流程A', '流程B']);

      // get：新流程=空画布
      expect(dao.flows.get(a.id)).toEqual({ id: a.id, name: '流程A', nodes: [], edges: [] });

      dao.flows.rename(a.id, '流程A2');
      expect(dao.flows.get(a.id).name).toBe('流程A2');

      dao.flows.reorder([b.id, a.id]);
      const reordered = createdOnly(dao.flows.list().items);
      expect(reordered.map((x) => x.name)).toEqual(['流程B', '流程A2']);

      dao.flows.softDelete(b.id);
      items = dao.flows.list().items;
      expect(items).toHaveLength(10);
      expect(createdOnly(items).map((x) => x.id)).toEqual([a.id]);
      expect(() => dao.flows.get(b.id)).toThrow(/流程不存在/);
      expect(() => dao.flows.rename(b.id, 'x')).toThrow(/流程不存在/);

      // 初始版本存在且为空快照
      const versions = dao.versions.list(a.id);
      expect(versions).toHaveLength(1);
      expect(versions[0]?.label).toBe('初始版本');
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('definitions：12 内置可读＋custom upsert 列↔DSL 深相等往返＋同 type 覆盖', () => {
    const tmp = makeTempDb();
    try {
      const { layer, dao } = openCtx(engine, tmp);
      expect(dao.definitions.loadAll()).toHaveLength(12);

      const def = customDef();
      dao.definitions.upsert(def);
      dao.definitions.upsert(customDef('custom.other'));
      let all = dao.definitions.loadAll();
      expect(all).toHaveLength(14);
      const got = all.find((d) => d.type === 'custom.demo');
      expect(got).toEqual(def); // N1~N8 全维度深相等（exec/inner/policy/io 可空列往返）

      // 同 type 覆盖（改名不增行）
      dao.definitions.upsert({ ...def, meta: { ...def.meta, name: '改名节点' } });
      all = dao.definitions.loadAll();
      expect(all).toHaveLength(14);
      expect(all.find((d) => d.type === 'custom.demo')?.meta.name).toBe('改名节点');
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('library：种子 3 项＋同名同型覆盖（保 id）＋异名插入＋删除', () => {
    const tmp = makeTempDb();
    try {
      const { layer, dao } = openCtx(engine, tmp);
      expect(dao.library.list().items).toHaveLength(3);

      // 同名同型覆盖：保留既有行 id
      dao.library.upsert({
        id: 'brand-new-id',
        name: '小红书搜索',
        type: 'cdp.extract',
        params: { selector: '.new' },
        scriptMeta: { lang: 'python', file: 'scripts/xhs_search.py' },
        updatedAt: 0,
      });
      const items = dao.library.list().items;
      expect(items).toHaveLength(3);
      const hit = items.find((x) => x.name === '小红书搜索');
      expect(hit?.id).toBe('lib-seed-1'); // id 未被顶替
      expect(hit?.params).toEqual({ selector: '.new' });

      // 异名同型 → 新行
      dao.library.upsert({
        id: 'lib-2',
        name: '微博搜索',
        type: 'cdp.extract',
        params: {},
        scriptMeta: { lang: 'ts', file: 'scripts/wb.ts' },
        updatedAt: 0,
      });
      expect(dao.library.list().items).toHaveLength(4);
      // 同名异型 → 新行
      dao.library.upsert({
        id: 'lib-3',
        name: '小红书搜索',
        type: 'http.request',
        params: {},
        scriptMeta: { lang: 'ts', file: 'scripts/x.ts' },
        updatedAt: 0,
      });
      expect(dao.library.list().items).toHaveLength(5);

      dao.library.delete('lib-seed-2');
      expect(dao.library.list().items).toHaveLength(4);
      dao.library.delete('lib-seed-2'); // 幂等
      expect(dao.library.list().items).toHaveLength(4);
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('runs：active 互斥（部分唯一索引口径）/ finish 计数 / get 含 nodeRuns', () => {
    const tmp = makeTempDb();
    try {
      const { layer, dao, save } = openCtx(engine, tmp);
      const flow = dao.flows.create('跑流');
      // 画布放一节点（node_runs.node_id FK）
      save.saveFlow({
        id: flow.id,
        name: '跑流',
        nodes: [flowNode('n1', 'trigger.manual')],
        edges: [],
        label: '手动保存',
      });

      const run = dao.runs.create(flow.id, '任务1');
      expect(() => dao.runs.create(flow.id, '任务2')).toThrow(/已有进行中的运行/);

      // 非 cdp 真径（T4-20 评审 blocker 收口）：nodeRunStart 不再前置 lanes 行——DAO 内
      // ensureLane 占位兜底（id=laneId、label=laneId、cdp 字段 NULL；CdpSessionManager 后续 upsert 覆盖）
      dao.nodeRuns.nodeRunStart({ nodeRunId: 'nr-1', runId: run.id, laneId: 'lane-1', nodeId: 'n1' });
      const out: NodeOut = { branch: 'out', partial: { rows: 3 } };
      dao.nodeRuns.nodeRunFinish({ nodeRunId: 'nr-1', status: 'done', output: out, error: null });

      dao.runs.finish({ runId: run.id, status: 'done', aborted: 0, failed: 1, total: 5, skips: ['n2'] });

      const detail = dao.runs.get(run.id);
      expect(detail.status).toBe('done');
      expect(detail.failed).toBe(1);
      expect(detail.total).toBe(5);
      expect(detail.skips).toEqual(['n2']);
      expect(detail.nodeRuns).toEqual([
        {
          id: 'nr-1',
          runId: run.id,
          laneId: 'lane-1',
          nodeId: 'n1',
          status: 'done',
          startedAt: expect.any(Number),
          endedAt: expect.any(Number),
          output: out,
          error: null,
        },
      ]);

      // 收官后可再开新 run（active 互斥解除）
      const run2 = dao.runs.create(flow.id, '任务2');
      expect(run2.id).not.toBe(run.id);
      // 不存在的 run → RUN-NOT-FOUND
      expect(() => dao.runs.get('nope')).toThrow(/运行不存在/);
      expect(() => dao.runs.finish({ runId: 'nope', status: 'error' })).toThrow(/运行不存在/);
      expect(() => dao.nodeRuns.nodeRunFinish({ nodeRunId: 'nope', status: 'error' })).toThrow(/运行不存在/);
      expect(() => dao.runs.create('flow-nope', 'x')).toThrow(/流程不存在/);
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('lanes（main 内部面）：upsert 覆盖 / close / get / listByRun', () => {
    const tmp = makeTempDb();
    try {
      const { layer, dao } = openCtx(engine, tmp);
      const flow = dao.flows.create('台账流');
      const run = dao.runs.create(flow.id, 'r1');
      dao.lanes.upsert({ id: 'laneKey', runId: run.id, label: '主会话', cdpPort: 9223, partition: 'p1', lastUrl: 'https://a', status: 'open' });
      dao.lanes.upsert({ id: 'laneKey', runId: run.id, label: '主会话', cdpPort: 9223, partition: 'p1', lastUrl: 'https://b', status: 'open' });
      expect(dao.lanes.get('laneKey')?.lastUrl).toBe('https://b');
      expect(dao.lanes.listByRun(run.id)).toHaveLength(1);
      dao.lanes.close('laneKey');
      expect(dao.lanes.get('laneKey')?.status).toBe('closed');
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('logs：append＋过滤＋beforeId 翻页＋滚动保留 20000（§4 ⚠ b）', () => {
    const tmp = makeTempDb();
    try {
      const { layer, dao } = openCtx(engine, tmp);
      const flow = dao.flows.create('日志流');
      const id1 = dao.logs.append({ level: 'info', msg: '一', flowId: flow.id }).id;
      dao.logs.append({ level: 'err', msg: '二', flowId: flow.id });
      const id3 = dao.logs.append({ level: 'ok', msg: '三', runId: 'r-x', laneLabel: 'L1' }).id;

      expect(dao.logs.list({ flowId: flow.id }).map((l) => l.msg)).toEqual(['二', '一']);
      expect(dao.logs.list({ runId: 'r-x' }).map((l) => l.msg)).toEqual(['三']);
      expect(dao.logs.list({ beforeId: id3, limit: 2 }).map((l) => l.msg)).toEqual(['二', '一']);
      expect(dao.logs.list({}).every((l) => typeof l.id === 'number' && typeof l.ts === 'string')).toBe(true);
      expect(id1).toBeGreaterThan(0);

      // 滚动保留：灌满 20000 行后 append 一条 → 恰 20000 且最旧行被挤掉
      const conn = layer.connection;
      conn.transaction(() => {
        const ins = conn.prepare('INSERT INTO logs (ts, level, msg) VALUES (:ts, :level, :msg)');
        for (let i = 0; i < LOGS_RETENTION_ROWS; i += 1) {
          ins.run({ ts: '2026-01-01T00:00:00Z', level: 'info', msg: `fill-${i}` });
        }
      });
      const appended = dao.logs.append({ level: 'warn', msg: '溢出行' });
      const count = conn.prepare('SELECT COUNT(*) AS c, MIN(id) AS m, MAX(id) AS x FROM logs').get() as {
        c: number;
        m: number;
        x: number;
      };
      expect(count.c).toBe(LOGS_RETENTION_ROWS);
      // 挤出推算：预置 3 行（id1..id3）＋fill 20000＋追加 1 = 20004 → 淘汰最旧 4 行 → min=5
      expect(count.m).toBe(5);
      expect(appended.id).toBe(count.x); // 追加行为最新行
      expect(dao.logs.list({ limit: 1 })[0]?.msg).toBe('溢出行');
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('settings：set/getAll KV 往返（含嵌套对象与 ai 引用键形）', () => {
    const tmp = makeTempDb();
    try {
      const { layer, dao } = openCtx(engine, tmp);
      expect(dao.settings.getAll()).toEqual({});
      dao.settings.set('autoSave', true);
      dao.settings.set('snap', false);
      dao.settings.set('market.baseUrl', 'https://constella.example');
      dao.settings.set('ai', { baseUrl: 'https://api.example', apiKeyRef: 'ref-key-1' });
      const all = dao.settings.getAll();
      expect(all.autoSave).toBe(true);
      expect(all.snap).toBe(false);
      expect(all['market.baseUrl']).toBe('https://constella.example');
      expect(all.ai).toEqual({ baseUrl: 'https://api.example', apiKeyRef: 'ref-key-1' });
      dao.settings.set('autoSave', false); // 覆写
      expect(dao.settings.getAll().autoSave).toBe(false);
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('hits：create pending → resolve → 状态过滤 / HIT-NOT-FOUND', () => {
    const tmp = makeTempDb();
    try {
      const { layer, dao, save } = openCtx(engine, tmp);
      const flow = dao.flows.create('断点流');
      save.saveFlow({ id: flow.id, name: '断点流', nodes: [flowNode('n1', 'human.review')], edges: [], label: '手动保存' });
      const run = dao.runs.create(flow.id, 'r');
      const hit = dao.hits.create({
        runId: run.id,
        nodeId: 'n1',
        question: '结果可用吗？',
        options: ['通过', '驳回'],
        dataSnapshot: { rows: [1, 2] },
      });
      expect(hit.id).not.toBe('');
      dao.hits.resolve(hit.id, 'resolved', { answer: '通过' });
      const resolved = dao.hits.list(run.id, 'resolved').items;
      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.payload).toEqual({ answer: '通过' });
      expect(resolved[0]?.dataSnapshot).toEqual({ rows: [1, 2] });
      expect(resolved[0]?.resolvedAt).not.toBeNull();
      expect(dao.hits.list(run.id, 'pending').items).toHaveLength(0);
      expect(dao.hits.list(run.id).items).toHaveLength(1); // 无 status 过滤=全量（具名键同构面）
      expect(() => dao.hits.resolve('nope', 'skipped', null)).toThrow(/断点不存在/);
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('assetPackages（main 内部面）：content_hash 防重复用 / listByType', () => {
    const tmp = makeTempDb();
    try {
      const { layer, dao } = openCtx(engine, tmp);
      const first = dao.assetPackages.upsert({
        nodeType: 'cdp.extract',
        pkgVersion: '1.0.0',
        contentHash: 'sha256-abc',
        dir: 'node-types/cdp.extract/1.0.0',
        manifest: { kind: 'node', name: 'x' },
      });
      expect(first.reused).toBe(false);
      const second = dao.assetPackages.upsert({
        nodeType: 'cdp.extract',
        pkgVersion: '1.0.0',
        contentHash: 'sha256-abc',
        dir: 'node-types/cdp.extract/1.0.0',
        manifest: { kind: 'node', name: 'x' },
      });
      expect(second).toEqual({ id: first.id, reused: true });
      // hasHash（T5-08 增补——ExamplePreloader 幂等查面）：命中/未命中两态
      expect(dao.assetPackages.hasHash('sha256-abc')).toBe(true);
      expect(dao.assetPackages.hasHash('sha256-other')).toBe(false);
      const rows = dao.assetPackages.listByType('cdp.extract');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.manifest).toEqual({ kind: 'node', name: 'x' });
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('pendingPublish：queue/checksum 幂等/list/remove', () => {
    const tmp = makeTempDb();
    try {
      const { layer, dao } = openCtx(engine, tmp);
      const q1 = dao.pendingPublish.queue(
        { kind: 'node', name: '我的节点', summary: 's', checksum: 'sha-1' },
        'C:/tmp/pkg.zip',
      );
      const q2 = dao.pendingPublish.queue({ kind: 'node', name: '我的节点', checksum: 'sha-1' }, 'C:/tmp/pkg2.zip');
      expect(q2.id).toBe(q1.id); // 同 checksum 幂等复用
      dao.pendingPublish.queue({ kind: 'flow', name: '我的流程', checksum: 'sha-2' }, 'C:/tmp/flow.zip');
      const items = dao.pendingPublish.list().items;
      expect(items).toHaveLength(2);
      expect(items[0]?.meta).toMatchObject({ kind: 'node', checksum: 'sha-1' });
      expect(items[0]?.filePath).toBe('C:/tmp/pkg.zip');
      dao.pendingPublish.remove(q1.id);
      expect(dao.pendingPublish.list().items.map((x) => x.meta.kind)).toEqual(['flow']);
      dao.pendingPublish.remove(q1.id); // 幂等
      layer.close();
    } finally {
      tmp.dispose();
    }
  });
});

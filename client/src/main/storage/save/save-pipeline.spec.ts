// SavePipeline 套件（T1-06 验收；C-06 §6.1a/b/c；双引擎）。
// 断言面：
//   a) 事务原子性：nodes.type 引用不存在定义 → FK 抛错 → flows/nodes/flow_versions 三表零变化；
//   b) 版本往返：save×2（手动/自动保存）→ versions.list LIFO 2 → restore(v1) 与首次入参深相等；
//   c) LIFO 20：连打 22 版 → 恰 20、最旧淘汰。
import { describe, expect, it } from 'vitest';
import type { DbEngine } from '../engine/connection';
import { makeTempDb, TEST_ENGINES } from '../testing/harness';
import { StorageLayer } from '../storage-layer';
import { SavePipeline, VERSIONS_PER_FLOW_LIMIT } from './save-pipeline';
import type { FlowDoc, FlowNode } from '@constella/shared/ipc';

function node(id: string, type: string): FlowNode {
  return { id, type, name: `N-${id}`, position: { x: 1, y: 2 }, params: { k: id } };
}

describe.each(TEST_ENGINES)('storage save [%s]', (engine: DbEngine) => {
  it('saveFlow 事务原子性：FK 注入失败 → 三表零变化（§6.1a；02 §13.1/S-2 ②）', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      const save = new SavePipeline(() => layer.connection);
      const conn = layer.connection;
      const flow = conn.prepare('SELECT id FROM flows LIMIT 1').get() as { id: string };

      // 基线保存成功
      const ok = save.saveFlow({
        id: flow.id,
        name: '改名OK',
        nodes: [node('n1', 'trigger.manual'), node('n2', 'data.transform')],
        edges: [{ id: 'e1', from: ['n1', 'out'], to: ['n2', 'in'] }],
        label: '手动保存',
      });
      expect(ok.versionId).not.toBe('');

      const dump = (): Record<string, unknown[]> => {
        const out: Record<string, unknown[]> = {};
        for (const t of ['flows', 'nodes', 'flow_versions']) {
          out[t] = conn.prepare(`SELECT * FROM ${t}`).all();
        }
        return out;
      };
      const before = dump();

      // 注入失败：nodes.type 引用不存在的定义 → foreign_keys=ON 抛错 → 事务整体回滚
      expect(() =>
        save.saveFlow({
          id: flow.id,
          name: '会被回滚的改名',
          nodes: [node('n1', 'trigger.manual'), node('n-bad', 'nope.missing')],
          edges: [],
          label: '自动保存',
        }),
      ).toThrow(/FOREIGN KEY|node_definitions/i);

      expect(dump()).toEqual(before); // 三表逐行零变化
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('版本往返：save×2 → LIFO 2 → restore(v1) 深相等（§6.1b）', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      const save = new SavePipeline(() => layer.connection);
      const conn = layer.connection;
      const flow = conn.prepare('SELECT id FROM flows LIMIT 1').get() as { id: string };

      const v1Nodes = [node('a1', 'trigger.manual'), node('a2', 'ai.llm'), node('a3', 'file.write')];
      const v1Edges: FlowDoc['edges'] = [
        { id: 'e1', from: ['a1', 'out'], to: ['a2', 'in'] },
        { id: 'e2', from: ['a2', 'out'], to: ['a3', 'in'] },
      ];
      const first = save.saveFlow({
        id: flow.id,
        name: '往返',
        nodes: v1Nodes,
        edges: v1Edges,
        label: '手动保存',
      });
      const second = save.saveFlow({
        id: flow.id,
        name: '往返',
        nodes: [node('a1', 'trigger.manual')],
        edges: [],
        label: '自动保存',
      });

      // LIFO：栈顶=第二次保存（f1 种子流程自带「初始版本」，共 3 版）
      const versions = conn
        .prepare('SELECT id, label FROM flow_versions WHERE flow_id = :f ORDER BY created_at DESC, rowid DESC')
        .all({ f: flow.id }) as unknown as Array<{ id: string; label: string }>;
      // 注意：种子流程 f1 自带「初始版本」——save×2 后该流程共 3 版（初始+2）
      expect(versions.map((v) => v.id)).toEqual([second.versionId, first.versionId, expect.any(String)]);
      expect(versions[0]?.label).toBe('自动保存');
      expect(versions[1]?.label).toBe('手动保存');
      expect(versions[2]?.label).toBe('初始版本');

      // restore(v1)：只读返回、与首次保存入参深相等
      const restored = save.restoreVersion(flow.id, first.versionId);
      expect(restored).toEqual({ nodes: v1Nodes, edges: v1Edges });
      // 只读：不新增版本
      expect(
        (conn.prepare('SELECT COUNT(*) AS c FROM flow_versions WHERE flow_id = :f').get({ f: flow.id }) as { c: number }).c,
      ).toBe(3);

      // 不存在的版本 → VERSION-NOT-FOUND
      expect(() => save.restoreVersion(flow.id, 'nope')).toThrow(/版本不存在/);
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('LIFO 20：连打 22 版 → 恰 20、最旧淘汰（§6.1c；A-5.4）', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      const save = new SavePipeline(() => layer.connection);
      const conn = layer.connection;
      const flow = conn.prepare('SELECT id FROM flows LIMIT 1').get() as { id: string };

      const versionIds: string[] = [];
      for (let i = 0; i < 22; i += 1) {
        versionIds.push(
          save.saveFlow({
            id: flow.id,
            name: `连打 ${i}`,
            nodes: [node(`n-${i}`, 'delay')],
            edges: [],
            label: i % 2 === 0 ? '自动保存' : '手动保存',
          }).versionId,
        );
      }
      const rows = conn
        .prepare('SELECT id FROM flow_versions WHERE flow_id = :f ORDER BY created_at DESC, rowid DESC')
        .all({ f: flow.id }) as unknown as Array<{ id: string }>;
      expect(rows).toHaveLength(VERSIONS_PER_FLOW_LIMIT); // 22 保存 + 1 初始版本 → 恰 20（最旧 3 版淘汰）
      const ids = rows.map((r) => r.id);
      // 最旧的 3 版（初始版本＋第 1、2 次保存）被淘汰；最新 20 版在册
      expect(ids).toContain(versionIds[21] as string);
      expect(ids).not.toContain(versionIds[0] as string);
      expect(ids).not.toContain(versionIds[1] as string);
      // LIFO 顶=最后一次保存
      expect(ids[0]).toBe(versionIds[21]);
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('soft_del 流拒绝保存（FLOW-NOT-FOUND）；不存在流程同', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      const save = new SavePipeline(() => layer.connection);
      const conn = layer.connection;
      const flow = conn.prepare('SELECT id FROM flows LIMIT 1').get() as { id: string };
      conn.prepare('UPDATE flows SET soft_del = 1 WHERE id = :id').run({ id: flow.id });
      expect(() =>
        save.saveFlow({ id: flow.id, name: 'x', nodes: [], edges: [], label: '手动保存' }),
      ).toThrow(/流程不存在/);
      expect(() =>
        save.saveFlow({ id: 'nope', name: 'x', nodes: [], edges: [], label: '手动保存' }),
      ).toThrow(/流程不存在/);
      layer.close();
    } finally {
      tmp.dispose();
    }
  });
});

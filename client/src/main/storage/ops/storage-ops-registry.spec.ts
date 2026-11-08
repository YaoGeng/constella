// StorageOpsRegistry 套件（T1-07；C-06 §6.6 单元面；双引擎）。
// 断言面：31 op 全量经注册表可路由；未知 op → IPC-UNKNOWN-OP；坏参 → VALIDATION-FAILED（明细聚合）；
// DAO 业务码透传（FLOW-NOT-FOUND）；factoryReset 危险 op 经注入编排生效；op 表 ↔ shared 联合
// 的三方一致由 scripts/check-storage-ops.mjs 断言（本套件断言键集完备性）。
import { describe, expect, it } from 'vitest';
import type { DbEngine } from '../engine/connection';
import { makeTempDb, TEST_ENGINES } from '../testing/harness';
import { StorageLayer } from '../storage-layer';
import { STORAGE_OP_KEYS, StorageOpsRegistry } from './storage-ops-registry';

describe.each(TEST_ENGINES)('storage ops registry [%s]', (engine: DbEngine) => {
  it('31 op 键集完备（与 C-06 §1 表域分布一致）', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      expect(layer.ops.ops).toHaveLength(31);
      const byDomain = new Map<string, number>();
      for (const op of STORAGE_OP_KEYS) {
        const domain = op.split('.')[0] as string;
        byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
      }
      expect(Object.fromEntries(byDomain)).toEqual({
        flows: 7,
        versions: 2,
        definitions: 2,
        library: 3,
        runs: 6,
        logs: 2,
        settings: 3,
        hits: 3,
        publish: 3,
      });
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('读路径 op 路由：flows.list/get、definitions.loadAll、versions.list、settings.getAll', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      const ops = layer.ops;

      const list = ops.invoke('flows.list') as { items: Array<{ id: string; name: string }> };
      expect(list.items).toHaveLength(9);
      const first = list.items[0] as { id: string; name: string };
      const doc = ops.invoke('flows.get', { id: first.id }) as { name: string; nodes: unknown[] };
      expect(doc.name).toBe(first.name);
      expect(Array.isArray(doc.nodes)).toBe(true);

      const defs = ops.invoke('definitions.loadAll') as unknown[];
      expect(defs).toHaveLength(12);
      const versions = ops.invoke('versions.list', { flowId: first.id }) as unknown[];
      expect(versions).toHaveLength(1);
      expect(ops.invoke('settings.getAll')).toEqual({});
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('写路径 op 路由：settings.set/getAll、library.upsert/list/delete、publish.queue/list/remove', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      const ops = layer.ops;

      ops.invoke('settings.set', { key: 'autoSave', value: true });
      expect(ops.invoke('settings.getAll')).toEqual({ autoSave: true });

      ops.invoke('library.delete', { id: 'lib-seed-1' });
      expect((ops.invoke('library.list') as { items: unknown[] }).items).toHaveLength(2);

      const q = ops.invoke('publish.queue', {
        meta: { kind: 'flow', name: '离线流', checksum: 'sha-x' },
        filePath: 'C:/tmp/x.zip',
      }) as { id: string };
      expect((ops.invoke('publish.list') as { items: unknown[] }).items).toHaveLength(1);
      ops.invoke('publish.remove', { id: q.id });
      expect((ops.invoke('publish.list') as { items: unknown[] }).items).toHaveLength(0);
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('flows.save 经 SavePipeline（label 校验五值；versionId 返回）', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      const ops = layer.ops;
      const flow = (ops.invoke('flows.list') as { items: Array<{ id: string }> }).items[0] as { id: string };
      const r = ops.invoke('flows.save', {
        id: flow.id,
        name: '经白名单保存',
        nodes: [{ id: 'w1', type: 'delay', name: '等', position: { x: 0, y: 0 }, params: { ms: 1 } }],
        edges: [],
        label: '流程工坊生成',
      }) as { versionId: string };
      expect(r.versionId).not.toBe('');
      // 非法 label → VALIDATION-FAILED
      expect(() =>
        ops.invoke('flows.save', { id: flow.id, name: 'x', nodes: [], edges: [], label: '不存在的标签' }),
      ).toThrow(/参数校验失败/);
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('未知 op → IPC-UNKNOWN-OP；坏参 → VALIDATION-FAILED（错误明细可见）；DAO 业务码透传', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      const ops = layer.ops;

      const unknown = (() => {
        try {
          ops.invoke('flows.drop'); // 无此 op——白名单外
        } catch (err) {
          return err as { code: string; message: string };
        }
        return null;
      })();
      expect(unknown?.code).toBe('IPC-UNKNOWN-OP');

      const bad = (() => {
        try {
          ops.invoke('flows.get', { id: 123 });
        } catch (err) {
          return err as { code: string; message: string };
        }
        return null;
      })();
      expect(bad?.code).toBe('VALIDATION-FAILED');
      expect(bad?.message).toContain('id:');

      // 未知字段拒绝（严格面）
      expect(() => ops.invoke('flows.get', { id: 'f1', extra: 1 })).toThrow(/未知字段/);

      // DAO 业务码透传
      const dao = (() => {
        try {
          ops.invoke('flows.get', { id: 'nope' });
        } catch (err) {
          return err as { code: string };
        }
        return null;
      })();
      expect(dao?.code).toBe('FLOW-NOT-FOUND');

      // 无参 op 传参 → 拒绝
      expect(() => ops.invoke('flows.list', { x: 1 })).toThrow(/参数校验失败/);
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('factoryReset 危险 op：经注入编排（删库→重迁→重种）', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      const ops = layer.ops;
      ops.invoke('settings.set', { key: 'snap', value: false });
      ops.invoke('flows.softDelete', { id: 'f1' });
      expect((ops.invoke('flows.list') as { items: unknown[] }).items).toHaveLength(8);

      ops.invoke('settings.factoryReset');

      expect((ops.invoke('flows.list') as { items: unknown[] }).items).toHaveLength(9);
      expect(ops.invoke('settings.getAll')).toEqual({}); // 用户数据清除
      // 重种后连接可用（经 DAO 面读写）
      ops.invoke('settings.set', { key: 'autoSave', value: true });
      expect(ops.invoke('settings.getAll')).toEqual({ autoSave: true });
      layer.close();
    } finally {
      tmp.dispose();
    }
  });
});

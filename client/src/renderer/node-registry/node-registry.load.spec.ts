// DefinitionLoader loadAll 装载序 ＋ createNodeRegistry 装配面（T1-10 验收；C-05 §6.1a/c）。
//
// 02 §8.2 启动序：store 载入 → validate（C-02 注入、缺省跳过）→ 失败标 broken → 批量注册；
// 种子先于校验（momus 观察2）——装载侧只消费 broken 标记、不做种子质量校验。
// store＝注入式（测试内存实现；生产装配＝IpcDefinitionStore〔T1-08〕经应用装配点注入，P-3 不 import）。
import { describe, expect, it, vi } from 'vitest';
import type { NodeDefinition, ParamField } from '@constella/shared/dsl';
import type { DefinitionValidator, NodeDefinitionStore } from './types';
import { DefinitionLoader } from './definition-loader';
import { RegistryCore } from './registry-core';
import { RegistryEvents } from './registry-events';
import { createNodeRegistry } from './node-registry';

function def(
  type: string,
  category: string,
  ins: string[],
  outs: string[],
  params: ParamField[] = [],
): NodeDefinition {
  return {
    type,
    kind: 'builtin',
    meta: { name: type, icon: 'x', category },
    ports: { ins, outs: outs.map((id) => ({ id, label: id })) },
    paramsSchema: params,
    exec: null,
    inner: null,
    policy: null,
    io: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
}

/** 12 内置形（类目/端口镜像种子口径；logic.branch 双出口、触发节点 ins=[]） */
const TWELVE: readonly NodeDefinition[] = [
  def('trigger.manual', '触发', [], ['out']),
  def('trigger.cron', '触发', [], ['out']),
  def('cdp.open', 'CDP', ['in'], ['ok']),
  def('cdp.extract', 'CDP', ['in'], ['out']),
  def('cdp.click', 'CDP', ['in'], ['ok']),
  def('http.request', '网络', ['in'], ['out']),
  def('ai.llm', 'AI', ['in'], ['out']),
  def('data.transform', '数据', ['in'], ['out']),
  def('logic.branch', '逻辑', ['in'], ['true', 'false']),
  def('delay', '逻辑', ['in'], ['out']),
  def('file.write', '数据', ['in'], ['out']),
  def('human.review', '交互', ['in'], ['approve', 'reject']),
];

/** 内存 store（注入式 NodeDefinitionStore 测试实现） */
function memStore(docs: readonly NodeDefinition[]): NodeDefinitionStore {
  return {
    loadAllDefinitions: async () => [...docs],
    upsertDefinition: async () => {},
  };
}

/** 恒失败校验器（§6.1c：只对指定 type 失败） */
function failOn(type: string): DefinitionValidator {
  return (doc) =>
    doc.type === type
      ? { ok: false, errors: [{ field: 'ports.outs', message: 'outs 为空' }] }
      : { ok: true, errors: [] };
}

describe('DefinitionLoader loadAll（02 §8.2 启动装载序）', () => {
  it('§6.1a 内存 store 载入 12 定义 → list() 长 12、LoadReport{total:12,loaded:12,broken:[]}；logic.branch outs 含 true/false', async () => {
    const core = new RegistryCore(new RegistryEvents());
    const loader = new DefinitionLoader(core);

    const report = await loader.loadAll(memStore(TWELVE));

    expect(report).toEqual({ total: 12, loaded: 12, broken: [] });
    expect(core.list()).toHaveLength(12);
    const outs = core.get('logic.branch')?.ports.outs.map((o) => o.id);
    expect(outs).toContain('true');
    expect(outs).toContain('false');
    expect(core.get('trigger.cron')?.ports.ins).toEqual([]); // ins=[] 触发节点可判
  });

  it('§6.1c validate 注入失败 → isBroken true 且 get 仍返回定义（画布 ⚠ 可渲染、运行闸可拦截）；broken 入报告', async () => {
    const core = new RegistryCore(new RegistryEvents());
    const loader = new DefinitionLoader(core);
    const rest = TWELVE.filter((d) => d.type !== 'logic.branch'); // 其余 11 条
    const bad = { ...def('logic.branch', '逻辑', ['in'], ['true', 'false']) };

    const report = await loader.loadAll(memStore([bad, ...rest]), failOn('logic.branch'));

    expect(report.total).toBe(12);
    expect(report.broken).toEqual(['logic.branch']);
    expect(report.loaded).toBe(12); // broken 定义仍注册入表
    expect(core.isBroken('logic.branch')).toBe(true);
    expect(core.get('logic.branch')?.type).toBe('logic.branch'); // ⚠ 但仍可 get
    expect(core.isBroken('trigger.manual')).toBe(false); // 其余不受牵连
  });

  it('validate 缺省 → 跳过校验（C-02 随 P4 注入；种子先于校验——装载侧不校验种子质量）', async () => {
    const core = new RegistryCore(new RegistryEvents());
    const loader = new DefinitionLoader(core);
    const doc = { ...def('delay', '逻辑', ['in'], []) }; // outs 空形（本会被 C-02 拒）——缺省即跳过

    const report = await loader.loadAll(memStore([doc]));

    expect(report).toEqual({ total: 1, loaded: 1, broken: [] });
    expect(core.isBroken('delay')).toBe(false);
  });

  it('store 重复 type → 同名同型覆盖合并：total=2、loaded=1（条目不新增）', async () => {
    const core = new RegistryCore(new RegistryEvents());
    const loader = new DefinitionLoader(core);
    const a = def('delay', '逻辑', ['in'], ['out'], [{ k: 'ms', t: 'number' }]);
    const b = def('delay', '逻辑', ['in'], ['out'], [{ k: 's', t: 'number' }]);

    const report = await loader.loadAll(memStore([a, b]));

    expect(report).toEqual({ total: 2, loaded: 1, broken: [] });
    expect(core.list()).toHaveLength(1);
    expect(core.get('delay')?.paramsSchema[0]?.k).toBe('s'); // 后者覆盖
  });

  it('重复装载幂等：旧定义与旧 broken 判定不残留（重载前 reset）', async () => {
    const core = new RegistryCore(new RegistryEvents());
    const loader = new DefinitionLoader(core);

    await loader.loadAll(memStore(TWELVE), failOn('ai.llm'));
    expect(core.isBroken('ai.llm')).toBe(true);

    const report = await loader.loadAll(memStore(TWELVE)); // 修复版重载、无自定义残留
    expect(report).toEqual({ total: 12, loaded: 12, broken: [] });
    expect(core.isBroken('ai.llm')).toBe(false);
    expect(core.list()).toHaveLength(12); // 旧条目不叠加

    await loader.loadAll(memStore(TWELVE.slice(0, 6)));
    expect(core.list()).toHaveLength(6); // 以 store 现量为准（重载＝全量替换）
  });

  it('装载过程触发 onChange（注册/覆盖/broken 标记均通知，消费方刷新类型网格）', async () => {
    const events = new RegistryEvents();
    const core = new RegistryCore(events);
    const loader = new DefinitionLoader(core);
    const fn = vi.fn();
    events.onChange(fn);

    await loader.loadAll(memStore(TWELVE), failOn('logic.branch'));

    const seen = fn.mock.calls.map((c) => c[0]);
    expect(seen).toContain('trigger.manual'); // 注册通知
    expect(seen.filter((t) => t === 'logic.branch').length).toBeGreaterThanOrEqual(1); // broken/注册通知
    expect(new Set(seen).size).toBe(12);
  });
});

describe('createNodeRegistry 装配面（C-05 §1 十方法）', () => {
  it('register/get/has/list/listByCategory/isBroken/isBuiltin/onChange 贯通；derivePerms/estimateMs 就位', async () => {
    const reg = createNodeRegistry();
    expect(typeof reg.register).toBe('function');
    expect(typeof reg.loadAll).toBe('function');

    const report = await reg.loadAll(memStore(TWELVE));
    expect(report.loaded).toBe(12);
    expect(reg.has('logic.branch')).toBe(true);
    expect(reg.get('logic.branch')?.ports.outs.map((o) => o.id)).toEqual(['true', 'false']);
    expect(reg.list()).toHaveLength(12);
    expect(Object.keys(reg.listByCategory())).toEqual(['触发', 'CDP', '网络', 'AI', '数据', '逻辑', '交互']);
    expect(reg.isBuiltin('delay')).toBe(true);
    expect(reg.isBroken('delay')).toBe(false);

    reg.register({ ...def('xhs.search', '社媒', ['in'], ['out']), kind: 'custom' });
    expect(reg.isBuiltin('xhs.search')).toBe(false);
    expect(reg.derivePerms(['xhs.search', 'delay'])).toEqual(['社媒']); // builtin 不计
    expect(reg.estimateMs('cdp.open')).toBe(1200);
    expect(reg.estimateMs('trigger.manual')).toBe(420); // 未命中默认（demo L1905）

    const fn = vi.fn();
    const off = reg.onChange(fn);
    reg.register({ ...def('xhs.detail', '社媒', ['in'], ['out']), kind: 'custom' });
    expect(fn).toHaveBeenCalledWith('xhs.detail');
    off();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

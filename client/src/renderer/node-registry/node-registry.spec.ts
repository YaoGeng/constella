// NodeRegistry 套件——RegistryCore / CategoryIndex / RegistryEvents / PermDeriver / EstimationTable
// （T1-09＋T1-11 验收；C-05 §6.1a/b/d/e＋§6.2；装载序面见 node-registry.load.spec.ts）。
//
// 断言面：
//   a) 12 定义注册后 list() 长 12、get('logic.branch').ports.outs 含 true/false、
//      ins=[] 类型可判触发节点（01 A-4.01）；
//   b) register 同名同型＝覆盖 params_schema 不新增条目（01 A-11.1）；
//   d) derivePerms：仅内置 → 空数组；社媒类目自定义 → ['社媒']；数据类目 → ['文件']
//      （01 A-13.1 / demo L2875-2880、L2908）；
//   e) listByCategory 覆盖全部已注册类目、组内注册序稳定；
//   onChange 卡内冻结语义：注册/覆盖/broken 标记均触发、退订后不再收（02 未定义）。
// 测试数据：本文件自带 12 内置形 fixture（type 集 ≡ shared BUILTIN_TYPE_IDS——
// P-3：模块目录禁 import storage 侧种子，故测试本地镜像、以清单常量对账）。
import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import type { NodeDefinition, NodeKind, ParamField } from '@constella/shared/dsl';
import { RegistryCore } from './registry-core';
import { CategoryIndex } from './category-index';
import { RegistryEvents } from './registry-events';
import {
  DEFAULT_ESTIMATION_MS,
  ESTIMATION_TABLE_MS,
  estimateMs,
} from './estimation-table';
import { PermDeriver } from './perm-deriver';

/** 测试定义构造简写（N1/N2 足形；其余维度取合法缺省） */
function def(
  type: string,
  category: string,
  ins: string[],
  outs: string[],
  kind: NodeKind = 'builtin',
  paramsSchema: ParamField[] = [],
): NodeDefinition {
  return {
    type,
    kind,
    meta: { name: type, icon: 'x', category },
    ports: { ins, outs: outs.map((id) => ({ id, label: id })) },
    paramsSchema,
    exec: null,
    inner: null,
    policy: null,
    io: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
}

/** 12 内置形 fixture（type 序 ≡ BUILTIN_TYPE_IDS；类目/端口镜像种子口径） */
const BUILTIN_FIXTURES: readonly NodeDefinition[] = [
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

describe('RegistryCore（Map＋broken 集合＋upsert 覆盖）', () => {
  it('§6.1a 12 定义注册 → list() 长 12；logic.branch outs 含 true/false；ins=[] 可判触发节点', () => {
    const core = new RegistryCore(new RegistryEvents());
    for (const d of BUILTIN_FIXTURES) core.register(d);

    expect(core.list()).toHaveLength(12);
    // fixture 与 shared 内置清单对账（防清单升版后测试数据漂移）
    expect(core.list().map((d) => d.type)).toEqual([...BUILTIN_TYPE_IDS]);

    const outs = core.get('logic.branch')?.ports.outs.map((o) => o.id);
    expect(outs).toContain('true');
    expect(outs).toContain('false');

    const trigger = core.get('trigger.manual');
    expect(trigger?.ports.ins).toEqual([]); // ins=[] → 触发节点（C-03 RunGate 三查之一）
    expect(core.get('cdp.open')?.ports.ins).toEqual(['in']);
  });

  it('§6.1b 同名同型覆盖：params_schema 被覆盖、条目不新增（01 A-11.1）', () => {
    const core = new RegistryCore(new RegistryEvents());
    core.register(def('custom.x', '社媒', ['in'], ['out'], 'custom', [{ k: 'a', t: 'text' }]));
    expect(core.list()).toHaveLength(1);

    core.register(
      def('custom.x', '社媒', ['in'], ['out'], 'custom', [
        { k: 'b', t: 'textarea' },
        { k: 'c', t: 'number' },
      ]),
    );
    expect(core.list()).toHaveLength(1); // 不新增条目
    expect(core.get('custom.x')?.paramsSchema.map((p) => p.k)).toEqual(['b', 'c']); // 覆盖
  });

  it('has/get 缺失面：未注册 type → has false、get undefined', () => {
    const core = new RegistryCore(new RegistryEvents());
    core.register(BUILTIN_FIXTURES[0]!);
    expect(core.has('trigger.manual')).toBe(true);
    expect(core.has('nope')).toBe(false);
    expect(core.get('nope')).toBeUndefined();
  });

  it('isBuiltin＝kind 判定（✨角标与 perms 排除内置共用判据）；markBroken 后 isBroken true 且 get 仍返回定义', () => {
    const core = new RegistryCore(new RegistryEvents());
    core.register(def('delay', '逻辑', ['in'], ['out'], 'builtin'));
    core.register(def('custom.y', 'AI', ['in'], ['out'], 'custom'));

    expect(core.isBuiltin('delay')).toBe(true);
    expect(core.isBuiltin('custom.y')).toBe(false); // kind==='custom' 非 ✨ 内置
    expect(core.isBuiltin('nope')).toBe(false);

    core.markBroken('custom.y');
    expect(core.isBroken('custom.y')).toBe(true);
    expect(core.get('custom.y')?.type).toBe('custom.y'); // broken 仍可 get（画布 ⚠ 可渲染）
  });

  it('register 覆盖时清旧 broken 判定（新定义取代旧定义及其状态）', () => {
    const core = new RegistryCore(new RegistryEvents());
    core.register(def('custom.z', '数据', ['in'], ['out'], 'custom'));
    core.markBroken('custom.z');
    expect(core.isBroken('custom.z')).toBe(true);

    core.register(def('custom.z', '数据', ['in'], ['out'], 'custom'));
    expect(core.isBroken('custom.z')).toBe(false); // 修复版 upsert → broken 不残留
  });
});

describe('CategoryIndex listByCategory（类目倒排＋稳定排序）', () => {
  it('§6.1e 覆盖全部已注册类目；组内注册序稳定；类目键按首次出现序', () => {
    const core = new RegistryCore(new RegistryEvents());
    for (const d of BUILTIN_FIXTURES) core.register(d);
    const byCat = new CategoryIndex().listByCategory(core.list());

    expect(Object.keys(byCat)).toEqual(['触发', 'CDP', '网络', 'AI', '数据', '逻辑', '交互']);
    expect(byCat['触发']?.map((d) => d.type)).toEqual(['trigger.manual', 'trigger.cron']);
    expect(byCat['逻辑']?.map((d) => d.type)).toEqual(['logic.branch', 'delay']);
    expect(byCat['数据']?.map((d) => d.type)).toEqual(['data.transform', 'file.write']);
  });

  it('覆盖改类目 → 旧组移除、新组收录（倒排随 upsert 收敛）', () => {
    const core = new RegistryCore(new RegistryEvents());
    core.register(def('custom.a', '社媒', ['in'], ['out'], 'custom'));
    core.register(def('custom.b', '数据', ['in'], ['out'], 'custom'));
    core.register(def('custom.a', 'AI', ['in'], ['out'], 'custom')); // 覆盖改类目

    const byCat = new CategoryIndex().listByCategory(core.list());
    expect(byCat['社媒']).toBeUndefined();
    expect(byCat['AI']?.map((d) => d.type)).toEqual(['custom.a']);
    expect(byCat['数据']?.map((d) => d.type)).toEqual(['custom.b']);
  });
});

describe('RegistryEvents onChange（⚠ 02 未定义、卡内冻结）', () => {
  it('注册/覆盖/broken 标记均触发；退订后不再收', () => {
    const events = new RegistryEvents();
    const core = new RegistryCore(events);
    const fn = vi.fn();
    const off = events.onChange(fn);
    expect(typeof off).toBe('function');

    core.register(def('custom.p', '社媒', ['in'], ['out'], 'custom'));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('custom.p');

    core.register(def('custom.p', '社媒', ['in'], ['out'], 'custom')); // 覆盖也触发
    expect(fn).toHaveBeenCalledTimes(2);

    core.markBroken('custom.p');
    expect(fn).toHaveBeenCalledTimes(3);

    off();
    core.register(def('custom.q', 'AI', ['in'], ['out'], 'custom'));
    core.markBroken('custom.q');
    expect(fn).toHaveBeenCalledTimes(3); // 退订后不再收
  });

  it('多订阅者各自独立退订', () => {
    const events = new RegistryEvents();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const off1 = events.onChange(fn1);
    events.onChange(fn2);
    events.emit('t1');
    expect(fn1).toHaveBeenCalledWith('t1');
    expect(fn2).toHaveBeenCalledWith('t1');
    off1();
    events.emit('t2');
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(2);
  });
});

describe('PermDeriver derivePerms（01 A-13.1；demo L2875-2880 同源）', () => {
  function coreWith(...docs: NodeDefinition[]): RegistryCore {
    const core = new RegistryCore(new RegistryEvents());
    for (const d of docs) core.register(d);
    return core;
  }

  it('§6.1d 仅内置类型 → 空数组（「无特殊权限」，demo L2908）', () => {
    const deriver = new PermDeriver(coreWith(...BUILTIN_FIXTURES));
    expect(deriver.derivePerms([...BUILTIN_TYPE_IDS])).toEqual([]);
    expect(deriver.derivePerms(['logic.branch', 'cdp.open'])).toEqual([]);
  });

  it('§6.1d 社媒类目自定义 → ["社媒"]；数据类目 → ["文件"]（数据→文件映射）', () => {
    const deriver = new PermDeriver(
      coreWith(
        ...BUILTIN_FIXTURES,
        def('xhs.search', '社媒', ['in'], ['out'], 'custom'),
        def('data.vault', '数据', ['in'], ['out'], 'custom'),
      ),
    );
    expect(deriver.derivePerms(['xhs.search'])).toEqual(['社媒']);
    expect(deriver.derivePerms(['data.vault'])).toEqual(['文件']);
  });

  it('CDP/网络/AI/交互同名直映；输入序去重保序', () => {
    const deriver = new PermDeriver(
      coreWith(
        def('c1', 'CDP', ['in'], ['out'], 'custom'),
        def('n1', '网络', ['in'], ['out'], 'custom'),
        def('a1', 'AI', ['in'], ['out'], 'custom'),
        def('i1', '交互', ['in'], ['out'], 'custom'),
        def('d1', '数据', ['in'], ['out'], 'custom'),
        def('c2', 'CDP', ['in'], ['out'], 'custom'),
      ),
    );
    expect(deriver.derivePerms(['c1', 'n1', 'a1', 'i1', 'd1', 'c2'])).toEqual([
      'CDP',
      '网络',
      'AI',
      '交互',
      '文件',
    ]);
  });

  it('未命中类目（逻辑等）与未注册 type 不产生标签', () => {
    const deriver = new PermDeriver(
      coreWith(
        ...BUILTIN_FIXTURES, // 逻辑/触发类目均不映射
        def('x.unknown-cat', '自定义新类目', ['in'], ['out'], 'custom'),
      ),
    );
    expect(deriver.derivePerms(['logic.branch', 'delay', 'trigger.manual', 'x.unknown-cat'])).toEqual([]);
    expect(deriver.derivePerms(['not.registered'])).toEqual([]);
    expect(deriver.derivePerms([])).toEqual([]);
  });
});

describe('EstimationTable estimateMs（demo DUR L1745-1747 同源冻结＋L1905 默认）', () => {
  it('13 项表值逐项一致（4 内置＋9 示例类型）', () => {
    expect(ESTIMATION_TABLE_MS).toEqual({
      'cdp.open': 1200,
      'ai.llm': 950,
      'cdp.extract': 650,
      'http.request': 700,
      'gate.login': 900,
      'xhs.search': 1500,
      'xhs.detail': 1100,
      'data.vault': 420,
      'ai.classify': 950,
      'ai.copygen': 900,
      'xhs.dm.send': 1300,
      'xhs.comment.post': 1000,
      'xhs.auto-reply': 1400,
    });
  });

  it('命中 → 表值；未命中 → 默认 420（demo L1905 `DUR[n.type]||420`）', () => {
    expect(estimateMs('cdp.open')).toBe(1200);
    expect(estimateMs('xhs.auto-reply')).toBe(1400);
    expect(estimateMs('trigger.manual')).toBe(DEFAULT_ESTIMATION_MS); // 内置未入表
    expect(estimateMs('custom.whatever')).toBe(DEFAULT_ESTIMATION_MS);
    expect(DEFAULT_ESTIMATION_MS).toBe(420);
  });
});

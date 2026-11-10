// N1 网络门单测（T5-12a / PM 缺省①锚冻结：节点门=N1 类目含「网络」——03 C-M1 §3
// NetProxyBridge 行「绑定判据＝N1 权限类目含『网络』→注入 CONSTELLA_NET_WS」）。
// 类目=N1 自由文本（X-01 dsl meta 行：触发/CDP/网络/AI/…；perms 推导参照）——判定=字符串
// 含「网络」；定义未注册/路径越界=门不开（不注入）。
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import { isNetCategory, netEligibleDefinition, nodeTypeOfScript } from './net-gate';

const def = (type: string, category: string): NodeDefinition => ({
  type,
  kind: 'custom',
  meta: { name: type, icon: '', category },
  ports: { ins: [], outs: [] },
  paramsSchema: [],
  exec: null,
  version: '1.0.0',
  packageVersion: '1.0.0',
});

const ROOT = path.join(path.sep === '\\' ? 'C:' : '', 't5-12a', 'node-types');

describe('isNetCategory（N1 类目自由文本含「网络」判定）', () => {
  it('类目恰为/含「网络」→ true；不含 → false', () => {
    expect(isNetCategory('网络')).toBe(true);
    expect(isNetCategory('网络·社媒')).toBe(true); // 自由文本含「网络」
    expect(isNetCategory('数据')).toBe(false);
    expect(isNetCategory('CDP')).toBe(false);
    expect(isNetCategory('')).toBe(false);
  });
});

describe('nodeTypeOfScript（node-types/<type>/<version>/… 首段解析）', () => {
  it('相对形首段=type；绝对形按 nodeTypesRoot 相对化取首段', () => {
    expect(nodeTypeOfScript('net.http/1.0.0/scripts/main.ts', ROOT)).toBe('net.http');
    expect(nodeTypeOfScript(path.join('net.http', '1.0.0', 'scripts', 'main.ts'), ROOT)).toBe('net.http');
    expect(nodeTypeOfScript(path.join(ROOT, 'a.b', '1.0.0', 'scripts', 'main.ts'), ROOT)).toBe('a.b');
  });

  it('越界/畸形 → undefined（与 resolveScriptPath 白名单同口径）', () => {
    expect(nodeTypeOfScript('../outside/1.0.0/scripts/main.ts', ROOT)).toBeUndefined();
    expect(nodeTypeOfScript(path.join(ROOT, '..', 'x', 'main.ts'), ROOT)).toBeUndefined();
    expect(nodeTypeOfScript('', ROOT)).toBeUndefined();
  });
});

describe('netEligibleDefinition（N1 网络门整判：type 解析→定义命中→类目含「网络」）', () => {
  const defs = [def('net.http', '网络'), def('data.transform', '数据'), def('net.scrape', '网络·CDP')];

  it('网络类目定义命中（含复合类目）；非网络/未注册 → undefined', () => {
    expect(netEligibleDefinition('net.http/1.0.0/scripts/main.ts', ROOT, defs)?.type).toBe('net.http');
    expect(netEligibleDefinition('net.scrape/1.0.0/scripts/main.ts', ROOT, defs)?.type).toBe('net.scrape');
    expect(netEligibleDefinition('data.transform/1.0.0/scripts/main.ts', ROOT, defs)).toBeUndefined();
    expect(netEligibleDefinition('unknown.type/1.0.0/scripts/main.ts', ROOT, defs)).toBeUndefined();
    expect(netEligibleDefinition('../escape/main.ts', ROOT, defs)).toBeUndefined();
  });
});

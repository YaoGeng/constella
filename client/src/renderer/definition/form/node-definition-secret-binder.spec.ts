// SecretParamBinder 验收（T4-08；C-02 §6.4；02 §3.4 secret:*/§12.3 掩码 sk-***）。
//
// secret:* 通道 mock 先行（区头 a：真通道=C-M1 SecretVault·T4-15 ⚠ 本卡后补跑）——mock bridge
// 形=X-01 secret.payload 三通道（set/get/del），get 未命中 in-band {value:null}。
// §6.4 两断言：①写入→params JSON 仅引用键（明文 grep 0 命中）；②读取→掩码 sk-***
// （明文经通道存取、永不进 params JSON/表单值——导出剥离 X-20 执行在 C-08，语义在此登记）。
import { describe, expect, it, vi } from 'vitest';
import type {
  SecretDelReq,
  SecretDelRes,
  SecretGetReq,
  SecretGetRes,
  SecretSetReq,
  SecretSetRes,
} from '@constella/shared/ipc';
import { createSecretParamBinder, SECRET_MASK, type SecretBridge } from './secret-param-binder';

/** 明文样本（永不入 params JSON——§6.4 grep 对象） */
const PLAINTEXT = 'sk-live-PLAINTEXT-fixture-0001';

/** mock 通道：in-memory vault＋调用记录（真通道=C-M1 SecretVault 随 T4-15 接线） */
function mockBridge(vault = new Map<string, string>()) {
  const calls: { ch: 'set' | 'get' | 'del'; req: unknown }[] = [];
  const bridge: SecretBridge = {
    set: vi.fn(async (req: SecretSetReq): Promise<SecretSetRes> => {
      calls.push({ ch: 'set', req });
      vault.set(req.key, req.value ?? '');
      return { ok: true };
    }),
    get: vi.fn(async (req: SecretGetReq): Promise<SecretGetRes> => {
      calls.push({ ch: 'get', req });
      const value = vault.get(req.key);
      return { value: value === undefined ? null : value };
    }),
    del: vi.fn(async (req: SecretDelReq): Promise<SecretDelRes> => {
      calls.push({ ch: 'del', req });
      vault.delete(req.key);
      return { ok: true };
    }),
  };
  return { bridge, vault, calls };
}

describe('§6.4 SecretParamBinder——引用键往返（secret:* 通道 mock 先行）', () => {
  it('写入：明文经 secret:set 入 vault，返回引用键——params JSON 仅引用键、明文 grep 0 命中', async () => {
    const { bridge, calls } = mockBridge();
    const binder = createSecretParamBinder(bridge, { scope: 'n1' });
    const refKey = await binder.saveSecret('apiKey', PLAINTEXT);

    // 引用键形：secret.param.<scope>.<k>（scope=节点实例域，自拟项留痕见实现头注）
    expect(refKey).toBe('secret.param.n1.apiKey');
    expect(calls).toEqual([{ ch: 'set', req: { key: 'secret.param.n1.apiKey', value: PLAINTEXT } }]);

    // 抽屉保存落 nodes.params JSON 只存引用键——明文零命中（§6.4 grep 断言）
    const paramsJson = JSON.stringify({ apiKey: refKey, maxNotes: 40 });
    expect(paramsJson).not.toContain(PLAINTEXT);
    expect(paramsJson).not.toContain('PLAINTEXT');
    expect(paramsJson).toContain(refKey);
  });

  it('读取：secret:get 命中 → 掩码 sk-***（明文不回 renderer 表单值）；未命中 → 空串', async () => {
    const { bridge } = mockBridge();
    const binder = createSecretParamBinder(bridge, { scope: 'n1' });
    await binder.saveSecret('apiKey', PLAINTEXT);

    expect(await binder.readMasked('apiKey')).toBe(SECRET_MASK); // 'sk-***'
    expect(await binder.readMasked('apiKey')).not.toContain(PLAINTEXT);
    expect(await binder.readMasked('neverSaved')).toBe(''); // get 未命中 in-band {value:null} → 空串
  });

  it('绑定展示（§3 bindSecret(k)）：已存 → {masked:sk-***, refKey}；未存 → 双空', async () => {
    const { bridge } = mockBridge();
    const binder = createSecretParamBinder(bridge, { scope: 'n1' });
    expect(binder.bindSecret('apiKey')).toEqual({ masked: '', refKey: '' }); // 未存

    const refKey = await binder.saveSecret('apiKey', PLAINTEXT);
    expect(binder.bindSecret('apiKey')).toEqual({ masked: SECRET_MASK, refKey });
  });

  it('初始引用键（实例 params 已存的 secret 值）经 opts.refs 注入 → 直接绑定掩码', () => {
    const { bridge } = mockBridge();
    const binder = createSecretParamBinder(bridge, {
      refs: { apiKey: 'secret.param.n1.apiKey' },
    });
    expect(binder.bindSecret('apiKey')).toEqual({
      masked: SECRET_MASK,
      refKey: 'secret.param.n1.apiKey',
    });
  });

  it('删除：secret:del 按引用键清 vault，绑定态归零', async () => {
    const { bridge, calls } = mockBridge();
    const binder = createSecretParamBinder(bridge, { scope: 'n1' });
    const refKey = await binder.saveSecret('apiKey', PLAINTEXT);

    await binder.removeSecret('apiKey');
    expect(calls[calls.length - 1]).toEqual({ ch: 'del', req: { key: refKey } });
    expect(binder.bindSecret('apiKey')).toEqual({ masked: '', refKey: '' });
    expect(await binder.readMasked('apiKey')).toBe('');
  });

  it('scope＝节点实例域：多实例同名字段引用键不串号', async () => {
    const { bridge } = mockBridge();
    const a = createSecretParamBinder(bridge, { scope: 'node-a' });
    const b = createSecretParamBinder(bridge, { scope: 'node-b' });
    expect(await a.saveSecret('apiKey', 'sk-a')).toBe('secret.param.node-a.apiKey');
    expect(await b.saveSecret('apiKey', 'sk-b')).toBe('secret.param.node-b.apiKey');
    expect(await a.readMasked('apiKey')).toBe(SECRET_MASK);
    expect(await b.readMasked('apiKey')).toBe(SECRET_MASK);
  });
});

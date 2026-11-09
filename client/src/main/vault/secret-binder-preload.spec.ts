// →补跑 T4-08（T4-15 / C-02 §6.2~§6.4 对应段留痕；05 T4-15 卡验收行）：
// SecretParamBinder 引用键写取/掩码 `sk-***` 读取——T4-08 的 mock bridge 腿经 preload 真面复跑。
//
// 链路（T4-14 preload-transport.spec 同模式）：SecretParamBinder（renderer/definition/form 真体，
// 跨域仅 import 其导出面）→ SecretBridge=生产装配点一行接线（bridge.set/get/del ↔
// window.constella.secretSet/Get/Del）→ ipc-loop 真径 → IpcGateway → SecretVault 真体
// （MockSafeStorage＋真 StorageLayer）。原 mock 腿（node-definition-secret-binder.spec.ts）
// 保留为 binder 单元面；本段=真通道复跑留痕（secret:* handler=T4-15 交付，mock 解除）。
import { describe, expect, it } from 'vitest';
import {
  createSecretParamBinder,
  SECRET_MASK,
  type SecretBridge,
} from '../../renderer/definition/form/secret-param-binder';
import { secretRefRowKey } from './secret-vault';
import { bootVaultFace, type VaultFaceEnv } from './testing/vault-face';

/** 明文样本（与 T4-08 原腿同样本——永不入 params JSON/settings 表/vault.bin 明文） */
const PLAINTEXT = 'sk-live-PLAINTEXT-fixture-0001';

/** grep -c 等价：子串出现次数 */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** 生产装配点一行接线（C-02 §2：SecretBridge ↔ preload secret:* 面） */
function bridgeOf(env: VaultFaceEnv): SecretBridge {
  return {
    set: (req) => env.api.secretSet(req),
    get: (req) => env.api.secretGet(req),
    del: (req) => env.api.secretDel(req),
  };
}

/** 真面环境＋binder 工厂 */
function bootBinder() {
  const env = bootVaultFace();
  const binder = (opts?: Parameters<typeof createSecretParamBinder>[1]) =>
    createSecretParamBinder(bridgeOf(env), opts);
  return { env, binder };
}

describe('T4-08 补跑·SecretParamBinder 经 preload 真面（=C-02 §6.4 对应段复跑）', () => {
  it('写入（§6.4①）：明文经 secret:set 入 safeStorage 密文仓，返回引用键——params JSON 仅引用键、明文 grep 0', async () => {
    const { env, binder } = bootBinder();
    try {
      const b = binder({ scope: 'n1' });
      const refKey = await b.saveSecret('apiKey', PLAINTEXT);

      expect(refKey).toBe('secret.param.n1.apiKey'); // 引用键形（C-02 §3 冻结）
      // 抽屉保存落 nodes.params JSON 只存引用键——明文零命中（§6.4 grep 断言）
      const paramsJson = JSON.stringify({ apiKey: refKey, maxNotes: 40 });
      expect(paramsJson).not.toContain(PLAINTEXT);
      expect(paramsJson).not.toContain('PLAINTEXT');
      expect(paramsJson).toContain(refKey);
      // 真盘面复证：vault.bin 密文（明文 grep 0）＋settings 表登记行值=引用键
      expect(countOccurrences(env.vaultBinContent(), PLAINTEXT)).toBe(0);
      expect(JSON.parse(env.settingsRow(secretRefRowKey(refKey))!.value)).toBe(refKey);
    } finally {
      env.dispose();
    }
  });

  it('读取（§6.4②）：secret:get 命中 → 掩码 sk-***（明文不回 renderer 表单值）；未命中 → 空串', async () => {
    const { env, binder } = bootBinder();
    try {
      const b = binder({ scope: 'n1' });
      await b.saveSecret('apiKey', PLAINTEXT);
      expect(await b.readMasked('apiKey')).toBe(SECRET_MASK); // 'sk-***'
      expect(await b.readMasked('apiKey')).not.toContain(PLAINTEXT);
      expect(await b.readMasked('neverSaved')).toBe(''); // get 未命中 in-band {value:null} → 空串
    } finally {
      env.dispose();
    }
  });

  it('绑定展示（bindSecret(k)）：已存 → {masked:sk-***, refKey}；未存 → 双空', async () => {
    const { env, binder } = bootBinder();
    try {
      const b = binder({ scope: 'n1' });
      expect(b.bindSecret('apiKey')).toEqual({ masked: '', refKey: '' }); // 未存
      const refKey = await b.saveSecret('apiKey', PLAINTEXT);
      expect(b.bindSecret('apiKey')).toEqual({ masked: SECRET_MASK, refKey });
    } finally {
      env.dispose();
    }
  });

  it('初始引用键（实例 params 已存的 secret 值）经 opts.refs 注入 → 直接绑定掩码', async () => {
    const { env, binder } = bootBinder();
    try {
      const b = binder({ refs: { apiKey: 'secret.param.n1.apiKey' } });
      expect(b.bindSecret('apiKey')).toEqual({
        masked: SECRET_MASK,
        refKey: 'secret.param.n1.apiKey',
      });
    } finally {
      env.dispose();
    }
  });

  it('删除（§6.4② 收尾）：secret:del 按引用键清仓，绑定态归零＋真盘面明文零残留', async () => {
    const { env, binder } = bootBinder();
    try {
      const b = binder({ scope: 'n1' });
      const refKey = await b.saveSecret('apiKey', PLAINTEXT);
      await b.removeSecret('apiKey');
      expect(b.bindSecret('apiKey')).toEqual({ masked: '', refKey: '' });
      expect(await b.readMasked('apiKey')).toBe('');
      expect(await env.api.secretGet({ key: refKey })).toEqual({ value: null }); // 通道面确认清仓
      expect(countOccurrences(env.vaultBinContent(), PLAINTEXT)).toBe(0);
    } finally {
      env.dispose();
    }
  });

  it('scope＝节点实例域：多实例同名字段引用键不串号（各持各的密钥）', async () => {
    const { env, binder } = bootBinder();
    try {
      const a = binder({ scope: 'node-a' });
      const b = binder({ scope: 'node-b' });
      expect(await a.saveSecret('apiKey', 'sk-a')).toBe('secret.param.node-a.apiKey');
      expect(await b.saveSecret('apiKey', 'sk-b')).toBe('secret.param.node-b.apiKey');
      expect(await a.readMasked('apiKey')).toBe(SECRET_MASK);
      expect(await b.readMasked('apiKey')).toBe(SECRET_MASK);
    } finally {
      env.dispose();
    }
  });

  it('真面往返完整性：掩码读出的背后是真密文（decrypt 复原原明文，非丢弃式假绿）', async () => {
    const { env, binder } = bootBinder();
    try {
      const b = binder({ scope: 'n1' });
      await b.saveSecret('apiKey', PLAINTEXT);
      const vaultValue = await env.api.secretGet({ key: 'secret.param.n1.apiKey' });
      expect(vaultValue).toEqual({ value: PLAINTEXT }); // 通道往返=safeStorage 解密原明文
    } finally {
      env.dispose();
    }
  });
});

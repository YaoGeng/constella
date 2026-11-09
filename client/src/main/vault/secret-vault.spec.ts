// SecretVault 组件验收（T4-15 / TDD-C-M1 §6.4＋§3 SecretVault 组件行）。
//
// §6.4 断言面：①set→get 往返相等；②del→get=null；③set('k','sk-test-123xyz') 后 vault.bin
// 明文 grep 0 命中＋settings 表值=引用键（明文不落任何盘面，02 §12.3）；另覆盖：持久往返重载、
// reveal 解密面（T4-16 env 注密消费）、safeStorage 不可用降级（init 不拦启动→SECRET-UNAVAILABLE）、
// 未 init 拒绝、vault.bin 损坏显式失败、真 SettingsDao 适配往返（settings-kv.ts）。
//
// electron 面口径（卡面）：safeStorage 经可注入面 mock（MockSafeStorage——DPAPI/Keychain 替身，
// XOR 掩码保证明文子串不进密文），不真启 electron。
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TEST_ENGINES } from '../storage/testing/harness';
import { StorageLayer } from '../storage/storage-layer';
import { createDaoSettingsKv } from './settings-kv';
import {
  SECRET_REF_ROW_PREFIX,
  SecretVault,
  VAULT_FILE_NAME,
  secretRefRowKey,
  type VaultSettingsKv,
} from './secret-vault';
import { MockSafeStorage } from './testing/mock-safe-storage';

/** §6.4 冻结明文样本 */
const PLAINTEXT = 'sk-test-123xyz';

/** grep -c 等价：子串出现次数 */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** 组件级环境（内存 settings KV；真 SettingsDao 往返见文末「真 DAO 适配」段） */
function makeVault(overrides: { available?: boolean } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'constella-vault-'));
  const safeStorage = new MockSafeStorage();
  if (overrides.available === false) safeStorage.available = false;
  const settingsRows = new Map<string, string | null>();
  const settings: VaultSettingsKv = {
    get: (key) => settingsRows.get(key) ?? null,
    set: (key, value) => {
      settingsRows.set(key, value);
    },
  };
  const vault = new SecretVault({ safeStorage, userDataDir: dir, settings });
  return {
    dir,
    safeStorage,
    vault,
    settingsRows,
    vaultBin: () => readFileSync(path.join(dir, VAULT_FILE_NAME), 'utf8'),
    init: () => vault.init({ registry: { handle: () => {} } }), // 组件段不挂真通道（通道面=secret-channels.spec）
    dispose: () => {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      } catch {
        /* 尽力清理（harness 同口径） */
      }
    },
  };
}

describe('SecretVault 组件（C-M1 §3 组件行＋§6.4）', () => {
  it('init（可用）：探测通过；重复 init 拒绝（单次语义）', () => {
    const env = makeVault();
    try {
      env.init();
      expect(env.vault.isAvailable).toBe(true);
      expect(() => env.init()).toThrow(/init/);
    } finally {
      env.dispose();
    }
  });

  it('§6.4① set→get 往返相等：明文经 safeStorage 加密往返无损', () => {
    const env = makeVault();
    try {
      env.init();
      env.vault.set('k', PLAINTEXT);
      expect(env.vault.get('k')).toBe(PLAINTEXT);
      expect(env.safeStorage.encryptCount).toBe(1);
      expect(env.safeStorage.decryptCount).toBe(1);
    } finally {
      env.dispose();
    }
  });

  it('§6.4③a 密文落 userData/vault.bin：明文 grep 0 命中＋密文可逆（非丢弃式脱敏）', () => {
    const env = makeVault();
    try {
      env.init();
      env.vault.set('k', PLAINTEXT);
      const content = env.vaultBin(); // 文件=path.join(userDataDir,'vault.bin')
      expect(countOccurrences(content, PLAINTEXT)).toBe(0); // grep -c "sk-test-123xyz" → 0
      const table = JSON.parse(content) as Record<string, string>;
      expect(Object.keys(table)).toEqual(['k']);
      expect(table.k).not.toBe(PLAINTEXT);
      // 密文可逆：safeStorage 解密复原明文（证明存的是真密文，非空值假绿）
      expect(env.safeStorage.decryptString(Buffer.from(table.k!, 'base64'))).toBe(PLAINTEXT);
    } finally {
      env.dispose();
    }
  });

  it('§6.4③b settings 只存引用键：登记行值=refKey（明文/密文零入 KV）', () => {
    const env = makeVault();
    try {
      env.init();
      env.vault.set('k', PLAINTEXT);
      expect(env.settingsRows.get(secretRefRowKey('k'))).toBe('k'); // 值=引用键（=key 本身）
      expect(JSON.stringify([...env.settingsRows.entries()])).not.toContain(PLAINTEXT);
      expect(secretRefRowKey('k')).toBe(`${SECRET_REF_ROW_PREFIX}k`);
    } finally {
      env.dispose();
    }
  });

  it('§6.4② del→get=null；幂等 del 未命中不抛；登记行置 null', () => {
    const env = makeVault();
    try {
      env.init();
      env.vault.set('k', PLAINTEXT);
      env.vault.del('k');
      expect(env.vault.get('k')).toBeNull();
      expect(() => env.vault.del('k')).not.toThrow(); // 幂等
      expect(env.settingsRows.get(secretRefRowKey('k'))).toBeNull();
      // del 后 vault.bin 明文仍 grep 0（清除而非残留）
      expect(countOccurrences(env.vaultBin(), PLAINTEXT)).toBe(0);
    } finally {
      env.dispose();
    }
  });

  it('reveal(refKey)：明文解密面（env 注密——T4-16 LLM_API_KEY 消费）；未命中抛错', () => {
    const env = makeVault();
    try {
      env.init();
      env.vault.set('ai.apiKey', PLAINTEXT);
      expect(env.vault.reveal('ai.apiKey')).toBe(PLAINTEXT);
      expect(() => env.vault.reveal('never.set')).toThrow(/引用键未命中/);
    } finally {
      env.dispose();
    }
  });

  it('持久往返：新实例同目录 init 后重载 vault.bin（密文跨实例可解）', () => {
    const env = makeVault();
    try {
      env.init();
      env.vault.set('k', PLAINTEXT);
      const reborn = new SecretVault({
        safeStorage: new MockSafeStorage(),
        userDataDir: env.dir,
        settings: {
          get: () => null,
          set: () => {},
        },
      });
      reborn.init({ registry: { handle: () => {} } });
      expect(reborn.get('k')).toBe(PLAINTEXT);
    } finally {
      env.dispose();
    }
  });

  it('降级（§1 矩阵）：safeStorage 不可用 → init 不拦启动，set/get/del/reveal 一律 SECRET-UNAVAILABLE', () => {
    const env = makeVault({ available: false });
    try {
      expect(() => env.init()).not.toThrow(); // 降级非崩溃（AppRuntime 启动序不因此失败）
      expect(env.vault.isAvailable).toBe(false);
      for (const op of [
        () => env.vault.set('k', 'x'),
        () => env.vault.get('k'),
        () => env.vault.del('k'),
        () => env.vault.reveal('k'),
      ]) {
        // 同步抛错面：四操作一律拒 SECRET-UNAVAILABLE（§1 矩阵——通道面同码 reject）
        expect(op).toThrowError(expect.objectContaining({ code: 'SECRET-UNAVAILABLE' }) as Error);
      }
    } finally {
      env.dispose();
    }
  });

  it('未 init 拒绝：AppRuntime 启动序步骤 5 之前不可用（misuse 显式报错）', () => {
    const env = makeVault();
    try {
      expect(() => env.vault.set('k', 'x')).toThrow(/未 init/);
      expect(() => env.vault.get('k')).toThrow(/未 init/);
    } finally {
      env.dispose();
    }
  });

  it('vault.bin 损坏 → init 显式抛错（不静默清空丢密钥）', () => {
    const env = makeVault();
    try {
      writeFileSync(path.join(env.dir, VAULT_FILE_NAME), 'not-json{', 'utf8');
      expect(() => env.init()).toThrow(/vault\.bin 损坏/);
    } finally {
      env.dispose();
    }
  });

  it('get 未命中（首启无仓）→ null：vault.bin 不存在不视为错误', () => {
    const env = makeVault();
    try {
      env.init();
      expect(env.vault.get('nope')).toBeNull();
    } finally {
      env.dispose();
    }
  });
});

describe('真 SettingsDao 适配（settings-kv.ts——settings KV main 内直调注入）', () => {
  it.each(TEST_ENGINES.map((e) => [e.name, e] as const))(
    'set 经 createDaoSettingsKv 落真 settings 表：行值 JSON=引用键、明文零命中（%s）',
    (_name, engine) => {
      const tmp = mkdtempSync(path.join(tmpdir(), 'constella-vault-dao-'));
      const storage = new StorageLayer(engine);
      try {
        storage.open(tmp);
        const vault = new SecretVault({
          safeStorage: new MockSafeStorage(),
          userDataDir: tmp,
          settings: createDaoSettingsKv(storage.dao),
        });
        vault.init({ registry: { handle: () => {} } });
        vault.set('k', PLAINTEXT);
        const row = storage.connection
          .prepare('SELECT key, value FROM settings WHERE key = :key')
          .get({ key: secretRefRowKey('k') }) as { key: string; value: string } | undefined;
        expect(row).toBeDefined();
        expect(JSON.parse(row!.value)).toBe('k'); // settings 表值=引用键（§6.4③b 真表面）
        const all = JSON.stringify(
          storage.connection.prepare('SELECT key, value FROM settings').all(),
        );
        expect(countOccurrences(all, PLAINTEXT)).toBe(0); // 全表明文零命中
      } finally {
        storage.close();
        try {
          rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        } catch {
          /* 尽力清理 */
        }
      }
    },
  );
});

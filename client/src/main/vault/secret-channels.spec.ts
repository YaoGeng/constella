// secret:* 三通道真面（T4-15 / TDD-C-M1 §1 矩阵 secret:set/get/del 行＋§6.4）。
//
// 链路：preload createConstellaApi（真面）↔ ipc-loop（Electron 实证语义：reject 值经 String
// 摊平进前缀消息——T4-14 基建）↔ IpcGateway（payload-schemas 通道面校验＋{code,message} 序列化）
// ↔ SecretVault 真体（MockSafeStorage＋真 StorageLayer）。断言：set→get 往返相等／del→
// {value:null} in-band／§6.4③ 全链盘面（vault.bin 明文 grep 0＋settings 表值=引用键）／
// SECRET-UNAVAILABLE 降级 reject 恰 {code,message} 无前缀泄漏／VALIDATION-FAILED 坏 payload／
// value 缺省形。另：AppRuntime 启动序接线（vault.init 在 app ready 后探测＋三通道挂 runtime.ipc
// ——§3 生命周期段「storage.init → SecretVault.init → …」）。
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createConstellaApi } from '../../preload/api';
import { createLoopMockElectron } from '../ipc/testing/ipc-loop';
import { SQLITE_ENGINE } from '../storage/engine/sqlite-engine';
import { StorageLayer } from '../storage/storage-layer';
import { AppRuntime } from '../runtime/app-runtime';
import { SecretVault, secretRefRowKey } from './secret-vault';
import { createDaoSettingsKv } from './settings-kv';
import { MockSafeStorage } from './testing/mock-safe-storage';
import { bootVaultFace } from './testing/vault-face';

/** §6.4 冻结明文样本 */
const PLAINTEXT = 'sk-test-123xyz';

/** grep -c 等价：子串出现次数 */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('secret:* 通道真面（preload ↔ IpcGateway ↔ SecretVault）', () => {
  it('set→get 往返相等（safeStorage 往返——§1 矩阵；结果恰 {ok}/{value} 形）', async () => {
    const env = bootVaultFace();
    try {
      await expect(env.api.secretSet({ key: 'k', value: PLAINTEXT })).resolves.toEqual({ ok: true });
      await expect(env.api.secretGet({ key: 'k' })).resolves.toEqual({ value: PLAINTEXT });
    } finally {
      env.dispose();
    }
  });

  it('del→get in-band {value:null}（非 reject——§1 矩阵末列）；del 幂等 {ok:true}', async () => {
    const env = bootVaultFace();
    try {
      await env.api.secretSet({ key: 'k', value: PLAINTEXT });
      await expect(env.api.secretDel({ key: 'k' })).resolves.toEqual({ ok: true });
      await expect(env.api.secretGet({ key: 'k' })).resolves.toEqual({ value: null });
      await expect(env.api.secretDel({ key: 'k' })).resolves.toEqual({ ok: true }); // 幂等
    } finally {
      env.dispose();
    }
  });

  it('§6.4③ 全链盘面：vault.bin 明文 grep 0＋settings 表值=引用键（真 SQLite 表）', async () => {
    const env = bootVaultFace();
    try {
      await env.api.secretSet({ key: 'k', value: PLAINTEXT });
      expect(countOccurrences(env.vaultBinContent(), PLAINTEXT)).toBe(0); // grep -c → 0
      const row = env.settingsRow(secretRefRowKey('k'));
      expect(row).toBeDefined();
      expect(JSON.parse(row!.value)).toBe('k'); // settings 表值=引用键（非明文/密文）
      const all = JSON.stringify(
        env.storage.connection.prepare('SELECT key, value FROM settings').all(),
      );
      expect(countOccurrences(all, PLAINTEXT)).toBe(0); // 全表明文零命中
    } finally {
      env.dispose();
    }
  });

  it('SECRET-UNAVAILABLE 降级：三通道 reject 恰 {code,message}（无 `Error invoking` 前缀泄漏）', async () => {
    const env = bootVaultFace({ available: false });
    try {
      const rejection = await env.api.secretGet({ key: 'k' }).catch((e: unknown) => e);
      expect(rejection).toMatchObject({ code: 'SECRET-UNAVAILABLE' });
      expect(Object.keys(rejection as object).sort()).toEqual(['code', 'message']); // 恰二键
      expect(JSON.stringify(rejection)).not.toContain('Error invoking remote method');
      await expect(env.api.secretSet({ key: 'k', value: 'x' })).rejects.toMatchObject({
        code: 'SECRET-UNAVAILABLE',
      });
      await expect(env.api.secretDel({ key: 'k' })).rejects.toMatchObject({
        code: 'SECRET-UNAVAILABLE',
      });
    } finally {
      env.dispose();
    }
  });

  it('VALIDATION-FAILED：坏 payload（key 非 string）经通道面拒绝（payload-schemas 既有校验）', async () => {
    const env = bootVaultFace();
    try {
      await expect(env.api.secretSet({ key: 42 } as never)).rejects.toMatchObject({
        code: 'VALIDATION-FAILED',
      });
    } finally {
      env.dispose();
    }
  });

  it('secret:set value 缺省按 \'\'（X-01 payload value? 可缺形）', async () => {
    const env = bootVaultFace();
    try {
      await expect(env.api.secretSet({ key: 'empty' })).resolves.toEqual({ ok: true });
      await expect(env.api.secretGet({ key: 'empty' })).resolves.toEqual({ value: '' });
    } finally {
      env.dispose();
    }
  });
});

describe('AppRuntime 启动序接线（§3 生命周期段：…storage.init → SecretVault.init → …）', () => {
  it('vault 经 services.vault 注入：safeStorage 探测在 app ready 后＋secret:* 挂 runtime.ipc＋preload 真面端到端', async () => {
    const log: string[] = [];
    const loop = createLoopMockElectron(log);
    const dir = mkdtempSync(path.join(tmpdir(), 'constella-vault-wiring-'));
    const storage = new StorageLayer(SQLITE_ENGINE);
    storage.open(dir);
    try {
      /** 探测时序埋点（safeStorage 须 app ready 后初始化——卡面实现要点） */
      class ProbingSafeStorage extends MockSafeStorage {
        override isEncryptionAvailable(): boolean {
          log.push('vault.probe');
          return super.isEncryptionAvailable();
        }
      }
      const vault = new SecretVault({
        safeStorage: new ProbingSafeStorage(),
        userDataDir: dir,
        settings: createDaoSettingsKv(storage.dao),
      });
      const runtime = new AppRuntime({
        electron: loop.api,
        rendererDir: path.join(dir, 'renderer'),
        preloadPath: path.join(dir, 'preload.js'),
        services: { vault },
      });
      await runtime.startup();

      // 时序：可用性探测严格晚于 app ready（§3 生命周期段步骤 2 → 步骤 5）
      expect(log.indexOf('vault.probe')).toBeGreaterThan(log.indexOf('app.whenReady'));
      // 端到端：preload 真面 → runtime.ipc（IpcGateway）→ SecretVault
      const api = createConstellaApi(loop.ipcRenderer);
      await expect(api.secretSet({ key: 'ai.apiKey', value: PLAINTEXT })).resolves.toEqual({
        ok: true,
      });
      await expect(api.secretGet({ key: 'ai.apiKey' })).resolves.toEqual({ value: PLAINTEXT });
    } finally {
      storage.close();
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      } catch {
        /* 尽力清理 */
      }
    }
  });
});

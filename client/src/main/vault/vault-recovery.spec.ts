// vault.bin 损坏恢复面套件（T4-20 携带登记项 4——T4-15 🟡 移交：真装配下 init 抛错→启动失败
// 路径的最小恢复面＝隔离损坏文件＋日志留痕（dialog 位留痕 P5+，不做完整 UI）。
//
// 断言面：
//   - 损坏（非 JSON 密文表）→ slot.init 不抛：vault.bin 改名隔离（vault.bin.corrupt-<ts>，
//     原内容保真）＋日志留痕＋换新空仓继续（set/get/reveal 可用——reveal 跟随换新实例）；
//   - 非损坏故障（safeStorage 探测抛错等）→ 原样上抛（真实故障仍拦启动，恢复面只吃损坏态）；
//   - 健康路径 → quarantinedAs=null、零日志。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IpcGateway } from '../ipc/ipc-gateway';
import { createLoopMockElectron } from '../ipc/testing/ipc-loop';
import { VAULT_FILE_NAME } from './secret-vault';
import { MockSafeStorage } from './testing/mock-safe-storage';
import { createRecoverableVault } from './vault-recovery';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      /* 尽力清理 */
    }
  }
});

function bootRecovery(over: { safeStorage?: MockSafeStorage } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'constella-vault-recovery-'));
  dirs.push(dir);
  const logs: string[] = [];
  const safeStorage = over.safeStorage ?? new MockSafeStorage();
  const recoverable = createRecoverableVault(
    { safeStorage, userDataDir: dir, settings: { get: () => null, set: () => {} } },
    { log: (...args: unknown[]) => logs.push(args.join(' ')) },
  );
  const registry = new IpcGateway({ ipcMain: createLoopMockElectron().ipcMain });
  return { dir, logs, recoverable, registry, init: () => recoverable.slot.init({ registry }) };
}

describe('vault.bin 损坏恢复面（T4-15 🟡 → T4-20 最小恢复）', () => {
  it('损坏 → init 不抛：隔离改名＋日志留痕＋换新空仓继续（reveal 跟随新实例）', () => {
    const env = bootRecovery();
    fs.writeFileSync(path.join(env.dir, VAULT_FILE_NAME), 'not-json{', 'utf8');
    expect(() => env.init()).not.toThrow();

    const quarantined = env.recoverable.quarantinedAs();
    expect(quarantined).not.toBeNull();
    expect(path.basename(quarantined!)).toMatch(/^vault\.bin\.corrupt-\d{8}T\d{6}$/);
    // 原损坏内容保真落在隔离文件；正式名不再存在（新仓按需重建）
    expect(fs.readFileSync(quarantined!, 'utf8')).toBe('not-json{');
    expect(fs.existsSync(path.join(env.dir, VAULT_FILE_NAME))).toBe(false);
    // 日志留痕（dialog 位=P5+ 扩展，本卡只日志）
    expect(env.logs.join('\n')).toContain('vault.bin 损坏');
    expect(env.logs.join('\n')).toContain(quarantined!);
    // 换新空仓可用：set/get 往返＋reveal 跟随
    const vault = env.recoverable.vault;
    vault.set('ai.apiKey', 'sk-recovered-1');
    expect(vault.get('ai.apiKey')).toBe('sk-recovered-1');
    expect(env.recoverable.reveal('ai.apiKey')).toBe('sk-recovered-1');
  });

  it('非损坏故障 → 原样上抛（真实故障仍拦启动——恢复面只吃损坏态）', () => {
    const bad = new MockSafeStorage();
    (bad as unknown as { isEncryptionAvailable: () => boolean }).isEncryptionAvailable = () => {
      throw new Error('probe blow-up');
    };
    const env = bootRecovery({ safeStorage: bad });
    expect(() => env.init()).toThrow(/probe blow-up/);
    expect(env.recoverable.quarantinedAs()).toBeNull();
  });

  it('健康路径 → quarantinedAs=null、零日志、vault 可用', () => {
    const env = bootRecovery();
    expect(() => env.init()).not.toThrow();
    expect(env.recoverable.quarantinedAs()).toBeNull();
    expect(env.logs).toEqual([]);
    env.recoverable.vault.set('k', 'v');
    expect(env.recoverable.reveal('k')).toBe('v');
  });
});

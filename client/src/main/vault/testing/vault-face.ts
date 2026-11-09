// vault 真面测试基建（T4-15）：ipc-loop 真径组装（preload createConstellaApi ↔ IpcGateway
// 〔payload-schemas 通道面〕↔ SecretVault 真体）＋真 StorageLayer（settings 表断言面）＋
// MockSafeStorage（DPAPI/Keychain 替身）。T4-14 preload-transport.spec 同模式——通道层/网关
// 校验/错误序列化全真，仅 electron 面为 mock（ipc-loop 按 Electron 实证语义摊平 reject）。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createConstellaApi, type ConstellaApi } from '../../../preload/api';
import { IpcGateway } from '../../ipc/ipc-gateway';
import { createLoopMockElectron } from '../../ipc/testing/ipc-loop';
import { SQLITE_ENGINE } from '../../storage/engine/sqlite-engine';
import { StorageLayer } from '../../storage/storage-layer';
import { SecretVault } from '../secret-vault';
import { createDaoSettingsKv } from '../settings-kv';
import { MockSafeStorage } from './mock-safe-storage';

/** 真面环境（dispose：先 close 连接释放 Windows 文件句柄，再递归删临时目录——harness 同口径） */
export interface VaultFaceEnv {
  dir: string;
  /** preload 真面（window.constella 半段——测试经 ipc-loop 直连） */
  api: ConstellaApi;
  vault: SecretVault;
  safeStorage: MockSafeStorage;
  storage: StorageLayer;
  /** settings 表原始行（§6.4「settings 表值=引用键」断言面——value 为 JSON 文本） */
  settingsRow(key: string): { key: string; value: string } | undefined;
  /** vault.bin 全文（§6.4「明文 grep 0 命中」断言面） */
  vaultBinContent(): string;
  dispose(): void;
}

/** 组装真面链（options.available=false → safeStorage 降级面） */
export function bootVaultFace(options: { available?: boolean } = {}): VaultFaceEnv {
  const dir = mkdtempSync(path.join(tmpdir(), 'constella-vault-'));
  const loop = createLoopMockElectron();
  const gateway = new IpcGateway({ ipcMain: loop.ipcMain });
  const safeStorage = new MockSafeStorage();
  if (options.available === false) safeStorage.available = false;
  const storage = new StorageLayer(SQLITE_ENGINE);
  storage.open(dir);
  const vault = new SecretVault({
    safeStorage,
    userDataDir: dir,
    settings: createDaoSettingsKv(storage.dao),
  });
  vault.init({ registry: gateway });
  const api = createConstellaApi(loop.ipcRenderer);
  return {
    dir,
    api,
    vault,
    safeStorage,
    storage,
    settingsRow(key) {
      return storage.connection
        .prepare('SELECT key, value FROM settings WHERE key = :key')
        .get({ key }) as { key: string; value: string } | undefined;
    },
    vaultBinContent() {
      return readFileSync(path.join(dir, 'vault.bin'), 'utf8');
    },
    dispose() {
      storage.close();
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      } catch {
        /* 尽力清理——残留 os.tmpdir 下随机名目录随系统清理（harness 同口径） */
      }
    },
  };
}

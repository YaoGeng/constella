// SecretVault —— safeStorage 密钥仓（T4-15 / TDD-C-M1 §3 SecretVault 组件行＋§1 矩阵 secret:* 行）。
//
// 语义冻结（§3 组件行＋§4 文件契约②）：
//   - safeStorage 加密（Windows DPAPI / macOS Keychain）——明文只在本组件内存瞬时存在与
//     reveal() env 注密面（T4-16 SandboxExecutor LLM_API_KEY 注入消费），不落任何盘面/日志
//     （02 §12.3/§12.4）；
//   - 密文落 userData/vault.bin（独立密文文件、不入 SQLite——密文不随版本/备份扩散，C-M1 §3 冻结；
//     factoryReset 目录清理面〔node-types/sandbox/backups〕不含 vault.bin，T4-20）；
//   - 引用键语义：refKey＝通道 key 本身（消费方一致——C-02 SecretParamBinder 以
//     `secret.param.<scope>.<k>` 为 key 调 set 且期望同串为 refKey 返回；C-11 settings.ai.apiKeyRef
//     存同名引用键；T4-16 reveal(refKey) 同面）；
//   - settings 只存引用键（02 §12.3/§7.1 settings「key TEXT PK; value JSON」）：每次 set 在
//     settings KV 登记行 `secret.ref.<refKey>`=refKey（main 内直调注入——T1-05 SettingsDao 适配见
//     settings-kv.ts），del 置 null（SettingsDao 无 del 面）；明文/密文永不入 SQLite。
//
// 自拟项留痕（02/03 未细化、本卡冻结）：①vault.bin 形=UTF-8 JSON 密文表
// { [refKey]: base64(safeStorage 密文) }（tmp+rename 原子写）；②settings 登记行键前缀
// `secret.ref.`——避让 X-01 SettingsSchema UI 键域（settings 表运行时无键域白名单，T1-05 头注）；
// ③secret:set payload value 可缺（X-01 形）→ 按 '' 存；④vault.bin 损坏（非 JSON 密文表）→
// init 抛错显式失败（不静默清空丢密钥）；⑤降级＝通道仍可注册但 set/get/del/reveal 一律拒
// SECRET-UNAVAILABLE（§1 矩阵），init 不抛错拦启动；⑥set 无跨仓原子性（vault.bin 为主存、
// settings 登记行为簿记——登记失败原样上抛，密文不回滚）。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { IPC_ERROR_CODES, type IpcErrorCode } from '@constella/shared/ipc';
import type { InvokeRegistry } from '../runtime/domain-channels';
import { registerSecretChannels } from './secret-channels';

/** electron safeStorage 可注入面（生产=main/index.ts 装配传 electron.safeStorage——须 app ready 后用；测试=MockSafeStorage） */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** settings KV main 内直调面（引用键登记——settings 只存引用键，02 §12.3；装配适配见 settings-kv.ts） */
export interface VaultSettingsKv {
  /** 读原始 KV 值（JSON 反序列化后；缺键=null） */
  get(key: string): unknown;
  /** 写 KV（null=登记行清除标记——SettingsDao 无 del 面，自拟项②） */
  set(key: string, value: string | null): void;
}

/** SecretVault 业务错误（Error+string code 同构形——经 IpcGateway serializeError 归一 {code,message}，§1 铁律） */
export class SecretVaultError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SecretVaultError';
  }
}

/**
 * vault.bin 损坏错误（T4-20 最小恢复面的判别标记——init 显式失败语义〔自拟项④〕不变，
 * 仅收敛为具名类供装配层 instanceof 判别：隔离损坏文件＋日志留痕后换新空仓继续启动，
 * 见 vault-recovery.ts；消息文案不变——T4-15 套件 /vault\.bin 损坏/ 断言面守恒）。
 */
export class VaultCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultCorruptError';
  }
}

/** vault.bin 文件名（C-M1 §4 文件契约②：userData/vault.bin） */
export const VAULT_FILE_NAME = 'vault.bin';

/** settings 引用键登记行前缀（自拟项②——见文件头） */
export const SECRET_REF_ROW_PREFIX = 'secret.ref.';

/** 引用键 → settings 登记行键 */
export function secretRefRowKey(refKey: string): string {
  return `${SECRET_REF_ROW_PREFIX}${refKey}`;
}

/** 构造依赖 */
export interface SecretVaultDeps {
  /** electron safeStorage 面（DPAPI/Keychain） */
  safeStorage: SafeStorageLike;
  /** userData 目录（vault.bin 落点=path.join(userDataDir, VAULT_FILE_NAME)） */
  userDataDir: string;
  /** settings KV main 内直调面（引用键登记） */
  settings: VaultSettingsKv;
}

/** 可用性态（init 一次探测——AppRuntime 启动序步骤 5，app ready 后） */
type Availability = 'uninitialized' | 'available' | 'unavailable';

export class SecretVault {
  private availability: Availability = 'uninitialized';
  /** refKey → base64(safeStorage 密文)（init 载入，set/del 持久化） */
  private readonly entries = new Map<string, string>();

  constructor(private readonly deps: SecretVaultDeps) {}

  /** 可用性（降级判定面） */
  get isAvailable(): boolean {
    return this.availability === 'available';
  }

  /**
   * 启动序（AppRuntime 步骤 5，须 app ready 后——系统钥匙串就绪前提）：可用性探测
   * （不可用→降级不拦启动，自拟项⑤）＋vault.bin 载入＋secret:set/get/del 三通道挂载。
   */
  init(options: { registry: InvokeRegistry }): void {
    if (this.availability !== 'uninitialized') {
      throw new Error('SecretVault.init 已调用（单次语义）');
    }
    this.availability = this.deps.safeStorage.isEncryptionAvailable()
      ? 'available'
      : 'unavailable';
    if (this.availability === 'available') this.loadVaultFile();
    registerSecretChannels(this, options.registry);
  }

  /** 写入（secret:set）：明文经 safeStorage 加密入 vault.bin＋settings 登记引用键 */
  set(key: string, value: string): void {
    this.assertUsable('set');
    const cipher = this.deps.safeStorage.encryptString(value);
    this.entries.set(key, cipher.toString('base64'));
    this.persist();
    // settings 只存引用键（行值=refKey——明文/密文永不入 SQLite；自拟项⑥：vault.bin 为主存）
    this.deps.settings.set(secretRefRowKey(key), key);
  }

  /** 读取（secret:get）：未命中 null（通道面 in-band {value:null}——§1 矩阵末列） */
  get(key: string): string | null {
    this.assertUsable('get');
    return this.decrypt(this.entries.get(key));
  }

  /** 删除（secret:del）：幂等（未命中亦成功） */
  del(key: string): void {
    this.assertUsable('del');
    if (!this.entries.delete(key)) return;
    this.persist();
    this.deps.settings.set(secretRefRowKey(key), null); // 登记行清除标记（自拟项②）
  }

  /** 解密面（明文仅 env 注密——T4-16 LLM_API_KEY env 注入消费）：未命中抛错（main 内部 misuse） */
  reveal(refKey: string): string {
    this.assertUsable('reveal');
    const plain = this.decrypt(this.entries.get(refKey));
    if (plain === null) throw new Error(`SecretVault.reveal：引用键未命中: ${refKey}`);
    return plain;
  }

  // ————————————————————————————————————————————

  private decrypt(b64: string | undefined): string | null {
    if (b64 === undefined) return null;
    return this.deps.safeStorage.decryptString(Buffer.from(b64, 'base64'));
  }

  private get vaultPath(): string {
    return path.join(this.deps.userDataDir, VAULT_FILE_NAME);
  }

  private loadVaultFile(): void {
    let raw: string;
    try {
      raw = readFileSync(this.vaultPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; // 首启无仓＝空仓
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new VaultCorruptError(`vault.bin 损坏（非 JSON 密文表）: ${this.vaultPath}`); // 自拟项④
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new VaultCorruptError(`vault.bin 损坏（密文表非对象）: ${this.vaultPath}`);
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string') {
        throw new VaultCorruptError(`vault.bin 损坏（密文值非 string）: ${this.vaultPath}`);
      }
      this.entries.set(k, v);
    }
  }

  /** 原子持久化（tmp+rename——半写不落正式名，自拟项①） */
  private persist(): void {
    const file = this.vaultPath;
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.entries)), 'utf8');
    renameSync(tmp, file);
  }

  private assertUsable(op: string): void {
    if (this.availability === 'uninitialized') {
      throw new Error(`SecretVault.${op}：未 init（AppRuntime 启动序步骤 5 调用）`);
    }
    if (this.availability === 'unavailable') {
      throw new SecretVaultError(
        IPC_ERROR_CODES.SECRET_UNAVAILABLE,
        'safeStorage 不可用（DPAPI/Keychain 未就绪）——密钥仓降级为不可用',
      );
    }
  }
}

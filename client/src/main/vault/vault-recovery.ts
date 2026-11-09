// vault.bin 损坏恢复面（T4-20 携带登记项 4——T4-15 🟡 移交的最小恢复装配）。
//
// 背景：真装配下 SecretVault.init 遇 vault.bin 损坏（非 JSON 密文表）显式抛错（T4-15 自拟项④
// 「不静默清空丢密钥」）→ AppRuntime 启动失败。本文件给出生产装配消费的最小恢复面：
//   隔离损坏文件（改名 vault.bin.corrupt-<ts>，原内容保真可追查）＋日志留痕（console.error
//   级——dialog 提示位留痕 P5+，不做完整 UI）＋换新空仓继续启动（密钥丢失已留痕告知）。
// 非损坏故障（safeStorage 探测抛错等）原样上抛——真实故障仍拦启动，恢复面只吃损坏态。
//
// 装配形态：AppRuntime SecretVaultSlot 的可恢复适配（init 内 try→隔离→换新重试；reveal
// 闭包读当前实例——SandboxExecutor env 注密面在启动完成后才消费，换新实例已就位）。
import { renameSync } from 'node:fs';
import path from 'node:path';
import type { InvokeRegistry } from '../runtime/domain-channels';
import type { SecretVaultSlot } from '../runtime/service-slots';
import { SecretVault, VaultCorruptError, VAULT_FILE_NAME, type SecretVaultDeps } from './secret-vault';

/** 可恢复 vault 装配面 */
export interface RecoverableVault {
  /** AppRuntime 五服务注入位（init 内含损坏恢复） */
  readonly slot: SecretVaultSlot;
  /** 当前 vault 实例（损坏隔离换新后跟随——测试/装配检查面） */
  readonly vault: SecretVault;
  /** reveal 注密面（SandboxExecutor LLM_API_KEY 消费——跟随当前实例） */
  reveal(refKey: string): string;
  /** 启动后检查面：损坏文件被隔离后的新路径（健康启动=null） */
  quarantinedAs(): string | null;
}

/** 隔离文件名后缀（<ts>=YYYYMMDDTHHmmss——排序可追查，秒级避免同秒覆写歧义） */
function corruptSuffix(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `corrupt-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}T${p(now.getHours())}${p(
    now.getMinutes(),
  )}${p(now.getSeconds())}`;
}

/**
 * 组装可恢复 vault（生产装配=production-assembly 消费）。
 * log 缺省 console.error——损坏属需用户可见的降级事件（dialog 位留痕 P5+）。
 */
export function createRecoverableVault(
  deps: SecretVaultDeps,
  options: { log?: (...args: unknown[]) => void } = {},
): RecoverableVault {
  const log = options.log ?? console.error;
  let vault = new SecretVault(deps);
  let quarantined: string | null = null;

  const slot: SecretVaultSlot = {
    init(initOptions: { registry: InvokeRegistry }): void {
      try {
        vault.init(initOptions);
        return; // 健康路径
      } catch (err) {
        if (!(err instanceof VaultCorruptError)) throw err; // 真实故障仍拦启动
        // 损坏态：隔离（改名失败＝不可恢复的文件系统故障，原样上抛拦启动）
        const from = path.join(deps.userDataDir, VAULT_FILE_NAME);
        quarantined = `${from}.${corruptSuffix()}`;
        renameSync(from, quarantined);
        log(
          `[constella-main] vault.bin 损坏已隔离: ${quarantined}——密钥仓重置为空仓继续启动` +
            '（已存密钥丢失；后续 dialog 提示位=P5+ 扩展，本卡日志留痕）',
        );
      }
      vault = new SecretVault(deps); // 换新空仓（首启语义——ENOENT 空仓）
      vault.init(initOptions);
    },
  };

  return {
    slot,
    get vault(): SecretVault {
      return vault;
    },
    reveal: (refKey: string) => vault.reveal(refKey),
    quarantinedAs: () => quarantined,
  };
}

// main/vault 域导出面（T4-15 / TDD-C-M1 §3 SecretVault 组件行）。
export {
  SECRET_REF_ROW_PREFIX,
  VAULT_FILE_NAME,
  SecretVault,
  SecretVaultError,
  secretRefRowKey,
} from './secret-vault';
export type { SafeStorageLike, SecretVaultDeps, VaultSettingsKv } from './secret-vault';
export { registerSecretChannels } from './secret-channels';
export type { SecretVaultChannelFace } from './secret-channels';
export { createDaoSettingsKv } from './settings-kv';

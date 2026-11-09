// StorageDao.settings → VaultSettingsKv 适配（T4-15：settings KV main 内直调注入——C-M1 §2
// 「C-06 main 进程内直调」同 dao.lanes 先例；生产装配点=StorageLayer.dao〔T4-20 组装〕）。
//
// settings 表为原始 KV（02 §7.1「key TEXT PK; value JSON」）；SettingsSchema 类型键=UI 已知
// 子集（T1-05 settings-dao.ts 头注：DAO 层不校验键域白名单）——vault 引用键登记行
// `secret.ref.*` 经窄 cast 写入（值恒 refKey/null，明文/密文永不入表）。
import type { SettingsKey } from '@constella/shared/settings';
import type { StorageDao } from '../storage/dao';
import type { VaultSettingsKv } from './secret-vault';

/** SettingsDao → vault settings KV 面（getAll 读/set 写——ConnGetter 闭包随 factoryReset 换连接零重建） */
export function createDaoSettingsKv(dao: Pick<StorageDao, 'settings'>): VaultSettingsKv {
  return {
    get(key: string): unknown {
      const all = dao.settings.getAll() as Record<string, unknown>;
      return key in all ? all[key] : null;
    },
    set(key: string, value: string | null): void {
      dao.settings.set(key as SettingsKey, value as never); // 窄 cast：见文件头（键域白名单不在 DAO 面）
    },
  };
}

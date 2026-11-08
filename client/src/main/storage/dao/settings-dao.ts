// SettingsDao（T1-05；C-06 §1 settings 域；02 §7.1 settings；01 A-14）。
// KV 表：value=X-01 SettingsSchema 形 JSON（X-01 §1 登记）；apiKey 只存 safeStorage 引用键
// （ai.apiKeyRef——明文不入 SQLite，02 §12.3；SecretVault 归 C-M1）。
// 键域校验说明：shared SettingsKey 是纯类型（无运行时键表），DAO 层不校验键域白名单——
// 键合法性由 ops 层结构校验（string）＋C-11 设置面板（P3）约束；上报项登记（shared 需补运行时键表）。
import type { SettingsKey, SettingsSchema } from '@constella/shared/settings';
import { type ConnGetter } from './dao-error';

export class SettingsDao {
  constructor(private readonly conn: ConnGetter) {}

  /** 全量 KV（缺键=未落库，上层取默认） */
  getAll(): Partial<SettingsSchema> {
    const rows = this.conn()
      .prepare('SELECT key, value FROM settings')
      .all() as unknown as Array<{ key: string; value: string }>;
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        // 损坏键跳过（getAll 不因单键损坏整挂——C-11 可 set 覆写修复）
      }
    }
    return out as Partial<SettingsSchema>;
  }

  set<K extends SettingsKey>(key: K, value: SettingsSchema[K]): void {
    this.conn()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (:key, :value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run({ key, value: JSON.stringify(value) });
  }
}

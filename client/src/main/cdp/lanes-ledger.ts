// lanes 台账面（T4-18 / TDD-C-M1 §2「main 内部：Cdp←C-06 lanes DAO」——02 §7.1 lanes；
// createSession/navigate/destroyRun 事务点）。结构形=C-06 LanesDao（client/src/main/storage/dao/
// lanes-dao.ts——main 内部面，不进 IPC 白名单）——生产装配（T4-20 StorageService 挂载后）注入
// dao.lanes 即结构匹配；本域不 import storage 模块（P-3 物理落位：组合根 index.ts 适配）。

/** lanes 台账行（LaneRecord 同构形；跨域复制不 import——T4-20 装配时可直传 LanesDao 实例） */
export interface LaneLedgerRecord {
  id: string; // = laneKey
  runId: string | null;
  label: string;
  cdpPort: number | null;
  partition: string | null;
  lastUrl: string | null;
  status: string;
}

/** cdp:* 会话台账消费面（CdpSessionManager 直调） */
export interface LanesLedger {
  upsert(lane: LaneLedgerRecord): void;
  close(id: string): void;
  listByRun(runId: string): LaneLedgerRecord[];
}

/**
 * 内存台账（缺省装配位）：T4-20 前无 StorageLayer 可注入——会话投影/listSessions 语义先行；
 * 生产以 C-06 dao.lanes 替换（同 interface 结构匹配，调用面零改）。
 */
export class InMemoryLanesLedger implements LanesLedger {
  private readonly rows = new Map<string, LaneLedgerRecord>();

  upsert(lane: LaneLedgerRecord): void {
    this.rows.set(lane.id, { ...lane });
  }

  close(id: string): void {
    const row = this.rows.get(id);
    if (row !== undefined) this.rows.set(id, { ...row, status: 'closed' });
  }

  listByRun(runId: string): LaneLedgerRecord[] {
    return [...this.rows.values()].filter((r) => r.runId === runId && r.status !== 'closed');
  }
}

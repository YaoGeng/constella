// cron 域 payload（X-01 §1 ipc 行；02 §3.4 cron:upsert / cron:cancel / cron:fired；
// C-M1 §1 Cron 行：表达式＝标准五段式（分 时 日 月 周）（X-18）；注册/同 flowId 覆盖；
// 错误码 CRON-INVALID-EXPR；cancel 幂等 in-band；错过不补跑（A-6.6））。

/** cron:upsert（r→m）：{flowId,cron} → {ok}（02 §3.4；trigger.cron 真实调度，D-5 ⚠ 运行期间生效） */
export interface CronUpsertReq {
  flowId: string;
  /** 标准五段式（分 时 日 月 周）；支持 * , - /步进（C-M1 §3 CronParser） */
  cron: string;
}

export interface CronUpsertRes {
  ok: boolean;
}

/** cron:cancel（r→m）：{flowId} → {ok}（02 §3.4；幂等 in-band） */
export interface CronCancelReq {
  flowId: string;
}

export interface CronCancelRes {
  ok: boolean;
}

/** cron:fired（m→r 推送）：{flowId}（02 §3.4；到点触发 startRun——脏闸与同流程不重复跑
 * 检查在 renderer RunGate，A-6.1/A-6.6） */
export interface CronFiredEvent {
  flowId: string;
}

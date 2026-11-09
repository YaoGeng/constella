// C-04 lane 生命周期规格单测（T4-05 验收＝TDD-C-04 §6.1a/§6.1b；验收命令
// `pnpm -F ./client exec vitest run cdp`）。断言面：
//   a) partitionOf 形=`persist:<flowId>·<laneLabel>`（含 `·`/中文——S-3 判据 1 C-04 形态实测锚）；
//   b) shouldCreate 状态机三转移：lane 首 cdp.*→create、同 lane 后续→navigate 只更新 URL、
//      run 收尾→destroy 统一销毁（demo L2813-2819/L2870 行为源）。
import { describe, expect, it } from 'vitest';
import {
  decideSessionAction,
  partitionOf,
  shouldCreate,
  type LaneSessionRecord,
} from './lane-session-spec';

/** lanes 台账 renderer 视图（02 §7.1 lanes 列子集：id=laneKey/label/cdp_port/partition/last_url） */
function lane(over: Partial<LaneSessionRecord> = {}): LaneSessionRecord {
  return {
    laneKey: 'f-001·北京',
    label: '北京',
    port: 9221,
    partition: 'persist:f-001·北京',
    lastUrl: 'https://rsj.beijing.gov.cn',
    ...over,
  };
}

describe('TDD-C-04 §6.1a partitionOf 形', () => {
  it('形=`persist:<flowId>·<laneLabel>`——`·` 与中文 laneLabel 原样入 partition（S-3 判据 1）', () => {
    expect(partitionOf('f-001', 'lane-主')).toBe('persist:f-001·lane-主');
  });

  it('laneLabel 自含 `·` 时不转义不重排（S-3：磁盘目录名编码由 Electron 承担，语义键保持原文）', () => {
    expect(partitionOf('f-2', 'a·b')).toBe('persist:f-2·a·b');
  });
});

describe('TDD-C-04 §6.1b shouldCreate 状态机三转移（demo L2813-2819）', () => {
  it('lane 首个 cdp.*（无会话）→createSession（shouldCreate=true）', () => {
    expect(shouldCreate(undefined)).toBe(true);
    expect(decideSessionAction(undefined, 'cdp-node')).toEqual({ kind: 'create' });
  });

  it('同 lane 后续 cdp.*（会话已在）→navigate 只更新 URL（shouldCreate=false）', () => {
    expect(shouldCreate(lane())).toBe(false);
    expect(decideSessionAction(lane(), 'cdp-node')).toEqual({ kind: 'navigate' });
  });

  it('run 收尾（done/error/aborted）→destroyRun 统一销毁——已有会话与无会话（幂等口径）同一决策', () => {
    expect(decideSessionAction(lane(), 'finalize')).toEqual({ kind: 'destroy' });
    expect(decideSessionAction(undefined, 'finalize')).toEqual({ kind: 'destroy' });
  });
});

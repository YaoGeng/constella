// cron-missed —— renderer 启动自算错过触发点（T6-11；TDD-C-10 §8②——A-6.6 只提示不补跑）。
//   语义源=main 侧 MissedFireDetector/CronScheduler（client/src/main/cron/——renderer 不 import
//   main，本文件为同口径重实现）：窗口=(lastAliveAt, now] 左开右闭（上次会话存活的分钟边界
//   归上次会话；启动前最后一刻的触发点属错过）；五段式（分 时 日 月 周，本地墙钟）子集
//   `*`/列表/区间/步进（单值基数=值..max，Vixie 兼容）；周 7 归一周日；DOM/DOW 均非字面 *
//   时按 POSIX OR；非法表达式跳过（启动不因单坏流程中断）；单流程防呆上限截断。
//   依据数据=settings 键 `cron.lastAliveAt`（C-M1 §4③——ISO 8601 字符串）＋flows 提取
//   trigger.cron；无新增推送通道（03 §8② 冻结）。

/** 单流程错过点防呆上限（=main MISSED_FIRE_CAP_PER_FLOW 同值——`* * * * *` 约七天量级） */
export const MISSED_FIRE_CAP_PER_FLOW = 10_000;

/** 扫描窗口防呆上限（≈29 年——超窗流程跳过，main next() 扫描上限同量级封顶） */
export const MAX_SCAN_WINDOW_MS = (366 * 29 + 2) * 24 * 3600_000;

/**
 * 五段式解析结果（dom/dow=null 表示字面 `*` 非受限——POSIX OR 判据；其余为受限值集）。
 * 整体非法由 parseCronExpr 返回 null 表达——不抛错（跳过口径）。
 */
export interface CronScheduleFields {
  readonly minute: ReadonlySet<number>;
  readonly hour: ReadonlySet<number>;
  readonly dayOfMonth: ReadonlySet<number> | null;
  readonly month: ReadonlySet<number>;
  readonly dayOfWeek: ReadonlySet<number> | null;
}

interface CronFieldSpec {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly dow: boolean;
}

/** 字段表（段序=分 时 日 月 周；周值域 0-7，7→0 归一；as const 五元组=noUncheckedIndexedAccess 豁免） */
const FIELDS = [
  { name: '分', min: 0, max: 59, dow: false },
  { name: '时', min: 0, max: 23, dow: false },
  { name: '日', min: 1, max: 31, dow: false },
  { name: '月', min: 1, max: 12, dow: false },
  { name: '周', min: 0, max: 7, dow: true },
] as const;

type FieldValues = ReadonlySet<number> | null | 'invalid';

function parseUint(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** 值域内取值（dow 容 0-7；越界/非数字 → null） */
function parseValue(raw: string, field: (typeof FIELDS)[number]): number | null {
  const v = parseUint(raw);
  if (v === null || v < field.min || v > field.max) return null;
  return field.dow && v === 7 ? 0 : v; // 周 7 归一周日
}

/**
 * 单字段解析：整段字面 `*` → null（非受限）；列表=元素并集（元素不得为 `*`）；
 * 元素=`*`|`a`|`a-b`（可带 `/n` 步进；`a/n`=a..max、`* /n` 去空格=全集步进）。
 * 非法（非数字/越界/倒序/步进<1/列表元素 *）→ 'invalid'。
 */
function parseField(part: string, field: (typeof FIELDS)[number]): FieldValues {
  if (part === '*') return null;
  const elements = part.includes(',') ? part.split(',') : [part];
  const values = new Set<number>();
  for (const el of elements) {
    if (el === '*') return 'invalid'; // 列表元素不得为 *（子集冻结——与 main 同口径）
    const stepIdx = el.indexOf('/');
    const step = stepIdx >= 0 ? parseUint(el.slice(stepIdx + 1)) : 1;
    if (step === null || step < 1) return 'invalid'; // 步进非数字/<1
    const base = stepIdx >= 0 ? el.slice(0, stepIdx) : el;
    let lo: number;
    let hi: number;
    if (base === '*') {
      lo = field.min;
      hi = field.dow ? 6 : field.max; // 周的 * 全集=0-6（7 为别名非独立值）
    } else {
      const rangeIdx = base.indexOf('-');
      if (rangeIdx >= 0) {
        const loRaw = parseValue(base.slice(0, rangeIdx), field);
        const hiRaw = parseValue(base.slice(rangeIdx + 1), field);
        if (loRaw === null || hiRaw === null || loRaw > hiRaw) return 'invalid'; // 非数字/越界/倒序
        lo = loRaw;
        hi = hiRaw;
      } else if (stepIdx >= 0) {
        const v = parseValue(base, field);
        if (v === null) return 'invalid';
        lo = v;
        hi = field.max; // 单值基数=值..max（Vixie 兼容；仅步进形展开）
      } else {
        const v = parseValue(base, field);
        if (v === null) return 'invalid';
        values.add(v); // 裸单值=恰该值
        continue;
      }
    }
    for (let v = lo; v <= hi; v += step) values.add(field.dow && v === 7 ? 0 : v);
  }
  return values;
}

function fullRange(min: number, max: number): ReadonlySet<number> {
  const s = new Set<number>();
  for (let v = min; v <= max; v += 1) s.add(v);
  return s;
}

/** 五段式解析（非法形 → null——调用方跳过该流程，启动不中断） */
export function parseCronExpr(expr: string): CronScheduleFields | null {
  const parts = expr.trim().split(/\s+/);
  if (expr.trim() === '' || parts.length !== 5) return null;
  const parsed: Array<ReadonlySet<number> | null> = [];
  for (let i = 0; i < 5; i += 1) {
    const v = parseField(parts[i] as string, FIELDS[i] as (typeof FIELDS)[number]);
    if (v === 'invalid') return null;
    parsed.push(v); // 已窄化（'invalid' 分支上方 return）
  }
  // 长度已守卫=5——窄 cast 五元组（main cron-parser L167-168 守卫后断言同先例）
  const [minute, hour, dom, month, dow] = parsed as [
    ReadonlySet<number> | null,
    ReadonlySet<number> | null,
    ReadonlySet<number> | null,
    ReadonlySet<number> | null,
    ReadonlySet<number> | null,
  ];
  return {
    minute: minute ?? fullRange(0, 59),
    hour: hour ?? fullRange(0, 23),
    dayOfMonth: dom,
    month: month ?? fullRange(1, 12),
    dayOfWeek: dow,
  };
}

/** 日匹配：DOM/DOW 均受限 → POSIX OR；单支受限单判；均 `*` 放行 */
function dayMatches(s: CronScheduleFields, t: Date): boolean {
  const dom = s.dayOfMonth;
  const dow = s.dayOfWeek;
  if (dom !== null && dow !== null) return dom.has(t.getDate()) || dow.has(t.getDay());
  if (dom !== null) return dom.has(t.getDate());
  if (dow !== null) return dow.has(t.getDay());
  return true;
}

/** 分钟匹配（本地墙钟——getMinutes/getHours/getDate/getMonth/getDay） */
function cronMatches(s: CronScheduleFields, t: Date): boolean {
  return s.minute.has(t.getMinutes()) && s.hour.has(t.getHours()) && s.month.has(t.getMonth() + 1) && dayMatches(s, t);
}

/** detect 入参形（flowId＋表达式——flows 提取 trigger.cron 投影） */
export interface MissedFireSchedule {
  readonly flowId: string;
  readonly cron: string;
}

/** 错过触发点（窗口 (lastAliveAt, now] 内一个匹配分钟，分钟对齐） */
export interface MissedFire {
  readonly flowId: string;
  readonly cron: string;
  readonly fireAt: number;
  readonly truncated: boolean;
}

/** 按 (lastAliveAt, now] 计算全部错过点（多流程并列；非法表达式/超窗流程→空贡献） */
export function computeMissedFires(
  lastAliveAt: number,
  schedules: ReadonlyArray<MissedFireSchedule>,
  now: () => number = Date.now,
): MissedFire[] {
  const nowMs = now();
  if (nowMs <= lastAliveAt) return []; // 空窗口
  const firstMinute = Math.floor(lastAliveAt / 60_000) * 60_000 + 60_000; // 左开：存活分钟边界归上次会话
  const lastMinute = Math.floor(nowMs / 60_000) * 60_000; // 右闭：启动前最后一刻属错过
  const missed: MissedFire[] = [];
  for (const { flowId, cron } of schedules) {
    if (lastMinute - firstMinute > MAX_SCAN_WINDOW_MS) continue; // 超窗防呆（不可达形封顶）
    const schedule = parseCronExpr(cron);
    if (schedule === null) continue; // 坏表达式跳过（启动不中断）
    let count = 0;
    for (let t = firstMinute; t <= lastMinute; t += 60_000) {
      if (!cronMatches(schedule, new Date(t))) continue;
      const truncated = count === MISSED_FIRE_CAP_PER_FLOW - 1; // 上限内末点携带标记
      missed.push({ flowId, cron, fireAt: t, truncated });
      if (truncated) break; // 丢弃后续点（防呆上限）
      count += 1;
    }
  }
  return missed;
}

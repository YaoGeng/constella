// CronParser —— 标准五段式解析＋next 匹配（T4-19 / TDD-C-M1 §3 CronParser 组件行）。
//
// 语义冻结（§3 组件行＋X-18；02 §15.4 C-M1 行）：
//   - 五段＝分 时 日 月 周（本地墙钟语义——分钟粒度常驻调度对齐用户可读时刻）；
//   - 字段支持 `*`、列表 `,`、区间 `-`、步进 `/n`（步进基数=字面 *、单值〔=值..max，Vixie
//     兼容〕或区间；`5/15`≡`5-59/15`）；周 0 与 7 均归一为周日；
//   - DOM/DOW 均非字面 `*` 时按 POSIX OR 语义（日命中=两支任一命中）；任一为 `*` 时按
//     受限支单判（POSIX AND 的退化形）。⚠ 仅字面 `*` 视为非受限——`*/2` 视为受限
//     （与 Vixie DOM_STAR 前缀 * 记法不同，本卡冻结口径，03 §3「子集本卡冻结」）；
//   - 非法形（段数≠5/值越界/步进 0/倒序区间/非数字/空列表元素）→ CRON-INVALID-EXPR；
//   - next(schedule, after) 返回严格晚于 after 的下一个匹配分钟（秒/毫秒归零）；
//     不可达（如 2 月 30 日）→ null。扫描上限≈40 年（2/29×指定周的世纪级稀有形按
//     28 年周期封顶，超限 null——防呆上限非调度语义）。
//
// 组件接口（§3 组件行）：parse(expr): Schedule | Invalid；next 匹配（CronScheduler 消费）。
import { IPC_ERROR_CODES, type IpcErrorCode } from '@constella/shared/ipc';

/** 非法 cron 表达式错误（throw 形经 IpcGateway 序列化 {code,message} reject——cron:upsert 通道面） */
export class CronInvalidExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CronInvalidExprError';
    this.code = IPC_ERROR_CODES.CRON_INVALID_EXPR;
  }

  /** 业务错误码（serialize-error 识别序 ②：Error＋非空 string code） */
  readonly code: IpcErrorCode;
}

/**
 * Schedule（§3 parse(expr): Schedule | Invalid 之 Schedule 半段）。
 * dayOfMonth/dayOfWeek=null 表示字面 `*`（非受限——DOM/DOW OR 判据）；非 null＝受限值集。
 */
export interface CronSchedule {
  /** 分 0-59 */
  readonly minute: ReadonlySet<number>;
  /** 时 0-23 */
  readonly hour: ReadonlySet<number>;
  /** 日 1-31；null=字面 * */
  readonly dayOfMonth: ReadonlySet<number> | null;
  /** 月 1-12 */
  readonly month: ReadonlySet<number>;
  /** 周 0-6（周日=0；7 已归一）；null=字面 * */
  readonly dayOfWeek: ReadonlySet<number> | null;
}

/** parse 失败半段（ok:false） */
export interface CronParseInvalid {
  readonly ok: false;
  readonly error: CronInvalidExprError;
}

/** parse 成功半段（ok:true） */
export interface CronParseOk {
  readonly ok: true;
  readonly schedule: CronSchedule;
}

export type CronParseResult = CronParseOk | CronParseInvalid;

/** 字段表（段序=分 时 日 月 周；值域冻结；as const=五元组——noUncheckedIndexedAccess 豁免） */
const FIELDS = [
  { name: '分', min: 0, max: 59, dow: false },
  { name: '时', min: 0, max: 23, dow: false },
  { name: '日', min: 1, max: 31, dow: false },
  { name: '月', min: 1, max: 12, dow: false },
  { name: '周', min: 0, max: 7, dow: true }, // 7→0 归一
] as const;

/** 单字段值域描述（FIELDS 元素型） */
type CronFieldSpec = (typeof FIELDS)[number];

/**
 * 逐字段解析（含 `,` 列表）：整段字面 `*` → null（非受限）；其余 → 值集并集。
 * 列表元素不得为 `*`（子集冻结——`*` 与列表混形无 POSIX 语义）。
 */
function parseField(part: string, field: CronFieldSpec): ReadonlySet<number> | null {
  if (!part.includes(',')) return parseFieldElement(part, field);
  const values = new Set<number>();
  for (const el of part.split(',')) {
    const set = parseFieldElement(el, field);
    if (set === null) {
      throw new CronInvalidExprError(`cron ${field.name}段列表元素不得为 *: ${part}`);
    }
    for (const v of set) values.add(v);
  }
  return values;
}

/** 单元素解析：`*` → null；`a` → {a}；`a-b` → 区间；带 `/n` 步进（星号/单值/区间基数，单值基数=值..max） */
function parseFieldElement(
  part: string,
  field: CronFieldSpec,
): ReadonlySet<number> | null {
  if (part === '*') return null;
  const stepIdx = part.indexOf('/');
  const step = stepIdx >= 0 ? parseStep(part.slice(stepIdx + 1)) : 1;
  const base = stepIdx >= 0 ? part.slice(0, stepIdx) : part;
  let lo: number;
  let hi: number;
  if (base === '*') {
    lo = field.min;
    hi = field.dow ? 6 : field.max; // 周的 * 全集=0-6（7 为别名非独立值）
  } else {
    const rangeIdx = base.indexOf('-');
    if (rangeIdx >= 0) {
      lo = parseValue(base.slice(0, rangeIdx), field);
      hi = parseValue(base.slice(rangeIdx + 1), field);
      if (lo > hi) throw new CronInvalidExprError(`cron ${field.name}段区间倒序: ${part}`);
    } else if (stepIdx >= 0) {
      lo = parseValue(base, field);
      hi = field.max; // 单值基数=值..max（Vixie 兼容）；仅步进形展开
    } else {
      return new Set([parseValue(base, field)]); // 裸单值=恰该值
    }
  }
  const values = new Set<number>();
  for (let v = lo; v <= hi; v += step) values.add(normalizeDow(v, field));
  return values;
}

function normalizeDow(v: number, field: CronFieldSpec): number {
  return field.dow && v === 7 ? 0 : v;
}

function parseValue(raw: string, field: CronFieldSpec): number {
  if (!/^\d+$/.test(raw)) throw new CronInvalidExprError(`cron ${field.name}段非数字: ${raw}`);
  const v = Number(raw);
  const min = field.dow ? 0 : field.min;
  if (v < min || v > field.max) {
    throw new CronInvalidExprError(`cron ${field.name}段越界（${min}-${field.max}）: ${raw}`);
  }
  return normalizeDow(v, field);
}

function parseStep(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new CronInvalidExprError(`cron 步进非数字: ${raw}`);
  const step = Number(raw);
  if (step < 1) throw new CronInvalidExprError(`cron 步进须 ≥1: ${raw}`);
  return step;
}

/** 日匹配：DOM/DOW 均非受限（null）→ POSIX OR；否则受限支单判（另一支 * 放行） */
function dayMatches(schedule: CronSchedule, date: Date): boolean {
  const dom = schedule.dayOfMonth;
  const dow = schedule.dayOfWeek;
  if (dom !== null && dow !== null) return dom.has(date.getDate()) || dow.has(date.getDay());
  if (dom !== null) return dom.has(date.getDate());
  if (dow !== null) return dow.has(date.getDay());
  return true;
}

/** next 扫描上限（天粒度——2/29 稀有形 28 年周期封顶＋余量） */
const MAX_SCAN_DAYS = 366 * 29 + 2;

export class CronParser {
  /**
   * 解析五段式表达式。
   * @param expr 形如 `0 20 * * *`（段间空白容忍）；非法形返回 ok:false＋CRON-INVALID-EXPR。
   */
  parse(expr: string): CronParseResult {
    try {
      const parts = expr.trim().split(/\s+/);
      if (expr.trim() === '' || parts.length !== 5) {
        throw new CronInvalidExprError(`cron 表达式须为五段式（分 时 日 月 周）: ${JSON.stringify(expr)}`);
      }
      // 长度已守卫=5——窄 cast 五元组（noUncheckedIndexedAccess；config-yaml.ts 守卫后断言同先例）
      const [pMin, pHour, pDom, pMonth, pDow] = parts as [string, string, string, string, string];
      const [fMin, fHour, fDom, fMonth, fDow] = FIELDS;
      const minute = parseField(pMin, fMin);
      const hour = parseField(pHour, fHour);
      const dom = parseField(pDom, fDom);
      const month = parseField(pMonth, fMonth);
      const dow = parseField(pDow, fDow);
      return {
        ok: true,
        schedule: {
          minute: minute ?? fullRange(0, 59),
          hour: hour ?? fullRange(0, 23),
          dayOfMonth: dom,
          month: month ?? fullRange(1, 12),
          dayOfWeek: dow,
        },
      };
    } catch (err) {
      if (err instanceof CronInvalidExprError) return { ok: false, error: err };
      throw err; // 不可达（parseFieldElement 只抛 CronInvalidExprError）——防御性上抛
    }
  }

  /**
   * next 匹配：严格晚于 after 的下一个匹配分钟（秒/毫秒归零）。
   * 逐级跳进（月不匹跳月初／日不匹跳次日／时不匹跳整点／分不匹跳下一分钟）。
   * @returns 不可达日期（扫描上限内无匹配）→ null
   */
  next(schedule: CronSchedule, after: Date): Date | null {
    // 候选起点=after 的下一分钟（秒/毫秒归零）——半开语义：恰在边界整分不命中本分
    let d = new Date(after.getTime());
    d.setSeconds(0, 0);
    d = new Date(d.getTime() + 60_000);
    for (let i = 0; i <= MAX_SCAN_DAYS; i++) {
      if (!schedule.month.has(d.getMonth() + 1)) {
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
        continue;
      }
      if (!dayMatches(schedule, d)) {
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
        continue;
      }
      if (!schedule.hour.has(d.getHours())) {
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1, 0, 0, 0);
        continue;
      }
      if (!schedule.minute.has(d.getMinutes())) {
        d = new Date(d.getTime() + 60_000);
        continue;
      }
      return d;
    }
    return null;
  }
}

function fullRange(min: number, max: number): ReadonlySet<number> {
  const s = new Set<number>();
  for (let v = min; v <= max; v++) s.add(v);
  return s;
}

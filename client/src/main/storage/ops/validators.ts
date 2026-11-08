// 参数校验器（T1-07；C-06 §3 StorageOpsRegistry 行「+参数校验」）。
//
// ⚠ 实现说明（上报项）：C-06 卡面写「Zod 参数校验」，但 zod 仅在 server 依赖内（^4.1.12），
// client 依赖未含且本波禁改 client/package.json／禁 pnpm add——故按同一职责落一个结构等价的
// 迷你校验器（错误聚合、严格未知键拒绝、可选/枚举/数组/对象组合子）。源型=X-01
// StorageInvokeReq 31 op 细型；校验失败抛 VALIDATION-FAILED（错误明细聚合在 message）。
export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface Validator<T> {
  (input: unknown): Validated<T>;
}

const ok = <T>(value: T): Validated<T> => ({ ok: true, value });
const fail = <T>(errors: string[]): Validated<T> => ({ ok: false, errors });

export function vString(opts: { min?: number; max?: number } = {}): Validator<string> {
  const { min = 1, max = 100_000 } = opts;
  return (input) => {
    if (typeof input !== 'string') return fail([`应为 string，实为 ${typeof input}`]);
    if (input.length < min) return fail([`长度 ${input.length} < ${min}`]);
    if (input.length > max) return fail([`长度 ${input.length} > ${max}`]);
    return ok(input);
  };
}

export function vNumber(): Validator<number> {
  return (input) => {
    if (typeof input !== 'number' || !Number.isFinite(input)) {
      return fail([`应为有限 number，实为 ${String(input)}`]);
    }
    return ok(input);
  };
}

export function vBoolean(): Validator<boolean> {
  return (input) => (typeof input === 'boolean' ? ok(input) : fail([`应为 boolean，实为 ${typeof input}`]));
}

export function vEnum<T extends string>(...values: T[]): Validator<T> {
  return (input) => {
    if (typeof input === 'string' && values.includes(input as T)) return ok(input as T);
    return fail([`应为枚举 [${values.join('|')}]，实为 ${JSON.stringify(input)}`]);
  };
}

export function vOptional<T>(inner: Validator<T>): Validator<T | undefined> {
  return (input) => (input === undefined ? ok(undefined) : inner(input));
}

export function vNullable<T>(inner: Validator<T>): Validator<T | null> {
  return (input) => (input === null ? ok(null) : inner(input));
}

export function vAny(): Validator<unknown> {
  return (input) => ok(input);
}

/** 普通对象（JSON 形；不做键白名单——params/payload 等自由形用） */
export function vRecord(): Validator<Record<string, unknown>> {
  return (input) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return fail([`应为对象，实为 ${Array.isArray(input) ? 'array' : typeof input}`]);
    }
    return ok(input as Record<string, unknown>);
  };
}

export function vArray<T>(item: Validator<T>): Validator<T[]> {
  return (input) => {
    if (!Array.isArray(input)) return fail([`应为数组，实为 ${typeof input}`]);
    const out: T[] = [];
    const errors: string[] = [];
    input.forEach((el, i) => {
      const r = item(el);
      if (r.ok) out.push(r.value);
      else errors.push(...r.errors.map((e) => `[${i}] ${e}`));
    });
    return errors.length > 0 ? fail(errors) : ok(out);
  };
}

/** 形状校验（严格：未知键拒绝——IPC 边界防字段名漂移） */
export function vObject<S extends Record<string, Validator<unknown>>>(
  shape: S,
): Validator<{ [K in keyof S]: S[K] extends Validator<infer T> ? T : never }> {
  return (input) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return fail([`应为对象，实为 ${Array.isArray(input) ? 'array' : typeof input}`]);
    }
    const src = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const [key, validator] of Object.entries(shape)) {
      const r = validator(src[key]);
      if (r.ok) out[key] = r.value;
      else errors.push(...r.errors.map((e) => `${key}: ${e}`));
    }
    const known = new Set(Object.keys(shape));
    for (const key of Object.keys(src)) {
      if (!known.has(key)) errors.push(`未知字段：${key}`);
    }
    return errors.length > 0 ? fail(errors) : ok(out as { [K in keyof S]: S[K] extends Validator<infer T> ? T : never });
  };
}

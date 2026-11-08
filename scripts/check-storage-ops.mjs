// Constella 存储白名单三方一致性断言（T1-07 交付；口径 = TDD-C-06 §6.6）。
//
// 用法：node scripts/check-storage-ops.mjs（仓库根；任意 cwd 均可，路径按 import.meta.url 定位）
//   成功：逐项打印 [ok] 并输出 `check-storage-ops ok`，exit 0
//   失败：打印全部差异项，exit 1
//
// 断言面（三方一致——X-01 op 联合 ≡ 03 C-06 §1 op 表 ≡ StorageOpsRegistry 注册表）：
//   1. shared/src/ipc/storage.payload.ts：StorageInvokeReq 联合的 31 个 op 字面量；
//   2. docs/03-模块设计.md：TDD-C-06 §1「renderer 面」op 表（9 域；反引号 token 解析，
//      硬编码域行匹配——文档表格格式变更时需同步本解析器）；
//   3. client/src/main/storage/ops/storage-ops-registry.ts：STORAGE_OP_KEYS 白名单键集
//      （并断言 Record<StorageOp, …> 注册表条目键与键集一致——无幽灵/缺位 op）；
//   4. 无 SQL 透传：client/src/main/storage/ops/*.ts 源内不得出现 SQL 语句字面量
//      （SELECT/INSERT INTO/UPDATE…SET/DELETE FROM/CREATE TABLE|INDEX/DROP/PRAGMA/VACUUM）。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(repoRoot, p), 'utf8');
const failures = [];

function diffSet(label, actual, expected) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  const missing = e.filter((x) => !a.includes(x));
  const extra = a.filter((x) => !e.includes(x));
  if (a.length !== new Set(a).size) failures.push(`${label}：存在重复项`);
  if (missing.length) failures.push(`${label}：缺 ${missing.join(', ')}`);
  if (extra.length) failures.push(`${label}：多 ${extra.join(', ')}`);
  return missing.length === 0 && extra.length === 0 && a.length === new Set(a).size;
}

// ———————— ① shared StorageInvokeReq op 联合 ————————
function extractSharedOps() {
  const src = read('shared/src/ipc/storage.payload.ts');
  const start = src.indexOf('export type StorageInvokeReq =');
  const end = src.indexOf('export type StorageOp =');
  if (start < 0 || end < 0 || end < start) return null;
  const union = src.slice(start, end);
  return [...union.matchAll(/op:\s*'([a-z]+\.[A-Za-z]+)'/g)].map((m) => m[1]);
}

// ———————— ② 03 C-06 §1 renderer 面 op 表（域行 → 反引号 token） ————————
const DOC_DOMAINS = ['flows', 'versions', 'definitions', 'library', 'runs', 'logs', 'settings', 'hits', 'publish'];

function extractDocOps() {
  const doc = read('docs/03-模块设计.md');
  const start = doc.indexOf('renderer 面');
  const end = doc.indexOf('main 内部面');
  if (start < 0 || end < 0 || end < start) return null;
  const table = doc.slice(start, end);
  const ops = [];
  for (const line of table.split('\n')) {
    const m = new RegExp(`^\\|\\s*(${DOC_DOMAINS.join('|')})\\b`).exec(line);
    if (m === null) continue;
    const domain = m[1];
    for (const tok of line.matchAll(/`([a-z][A-Za-z0-9]*)[^`]*`/g)) {
      ops.push(`${domain}.${tok[1]}`);
    }
  }
  return ops;
}

// ———————— ③ StorageOpsRegistry 注册表 ————————
function extractRegistryOps() {
  const src = read('client/src/main/storage/ops/storage-ops-registry.ts');
  const arr = /export const STORAGE_OP_KEYS = \[([\s\S]*?)\] as const/.exec(src)?.[1];
  if (arr === undefined) return null;
  const keys = [...arr.matchAll(/'([a-z]+\.[A-Za-z]+)'/g)].map((m) => m[1]);
  // Record<StorageOp, OpEntry> 条目键（注册表无幽灵/缺位）
  const body = /export const STORAGE_OP_ENTRIES: Record<StorageOp, OpEntry> = \{([\s\S]*?)\n\};/.exec(src)?.[1];
  const entries = body === undefined ? null : [...body.matchAll(/\n  '((?:[a-z]+)\.(?:[A-Za-z]+))':/g)].map((m) => m[1]);
  return { keys, entries };
}

// ———————— ④ ops 层无 SQL 透传 ————————
function scanSqlPassthrough() {
  const dir = path.join(repoRoot, 'client/src/main/storage/ops');
  const sqlRe = /\b(SELECT\b.+\bFROM\b|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b|CREATE\s+(TABLE|UNIQUE\s+INDEX|INDEX)\b|DROP\s+(TABLE|INDEX)\b|PRAGMA\s|VACUUM\s|BEGIN(\s+IMMEDIATE)?;|COMMIT;|ROLLBACK;)/i;
  const hits = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts') || f.endsWith('.spec.ts')) continue;
    const src = read(path.posix.join('client/src/main/storage/ops', f));
    const m = sqlRe.exec(src);
    if (m !== null) hits.push(`${f}: ${m[0].slice(0, 60)}`);
  }
  return hits;
}

const sharedOps = extractSharedOps();
if (sharedOps === null) {
  failures.push('shared/src/ipc/storage.payload.ts：未找到 StorageInvokeReq 联合');
} else {
  console.log(`[ok] X-01 StorageInvokeReq op 联合：${sharedOps.length} 个`);
}

const docOps = extractDocOps();
if (docOps === null) {
  failures.push('docs/03-模块设计.md：未解析到 C-06 §1 renderer 面 op 表');
} else {
  console.log(`[ok] 03 C-06 §1 op 表：${new Set(docOps).size} 个（9 域）`);
}

const reg = extractRegistryOps();
if (reg === null) {
  failures.push('client/src/main/storage/ops/storage-ops-registry.ts：未找到 STORAGE_OP_KEYS');
} else {
  console.log(`[ok] StorageOpsRegistry STORAGE_OP_KEYS：${reg.keys.length} 个`);
  if (reg.entries !== null && !diffSet('STORAGE_OP_ENTRIES 条目', reg.entries, reg.keys)) {
    /* diffSet 已记 failures */
  } else if (reg.entries === null) {
    failures.push('storage-ops-registry.ts：未解析到 STORAGE_OP_ENTRIES 条目表');
  }
}

const base = sharedOps ?? reg?.keys ?? [];
if (base.length > 0 && docOps !== null) diffSet('03 §1 表 ↔ X-01 联合', docOps, base);
if (sharedOps !== null && reg !== null) diffSet('注册表 ↔ X-01 联合', reg.keys, sharedOps);

const sqlHits = scanSqlPassthrough();
if (sqlHits.length > 0) {
  for (const h of sqlHits) failures.push(`ops 层 SQL 透传：${h}`);
} else {
  console.log('[ok] ops 层无 SQL 透传（0 条语句字面量）');
}

if (failures.length > 0) {
  console.error(`check-storage-ops FAILED（${failures.length} 项差异）:`);
  for (const f of failures) console.error(`[fail] ${f}`);
  process.exit(1);
}
console.log('check-storage-ops ok');

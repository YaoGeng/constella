// shared 常量族 ↔ 文档锚一致性断言（T0-12 交付；口径 = TDD-X-01 §6.5）。
//
// 用法：node scripts/check-shared-consts.mjs（仓库根；任意 cwd 均可，路径按 import.meta.url 定位）
//   成功：逐族打印 [ok] 并输出 `check-shared-consts ok`，exit 0
//   失败：打印全部差异项，exit 1
//
// 断言面（期望集＝下方硬编码，逐项抄自文档锚，改动文档须同步改本表）：
//   1. IPC 通道集合 ↔ 02 §3.4 表逐行一致（24 通道 = 21 r→m invoke + 3 m→r 推送；
//      IPC_CHANNELS 值集全等 + INVOKE/PUSH 子集恰好划分全集）
//   2. 错误码 ↔ 02 §6.1 总表逐项一致（15 项 = 7 通用 + 8 业务；dto ErrorCode 联合与
//      constants ERROR_CODES 值集双核对）
//   3. BUILTIN_TYPE_IDS ↔ 01 PRD-A4-01 清单逐项一致（12 type；V1.1 out.* 五类型随 B2 升版）
//   增补断言（非 §6.5 必需面，同为冻结集）：
//   4. storage DAO 业务错误码初集（X-01 §1 constants 行：5 项，全集随 M5 C-06 任务卡冻结）
//   5. cdp 桥 method 白名单（T0-07 会签冻结：9 项）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(repoRoot, p), 'utf8');

const failures = [];

/** 从 TS 源码抽取 `export const X = {…} as const [satisfies …];` / `[…] as const;` 块内的全部单引号字符串 */
function extractConstStrings(src, constName) {
  const m = src.match(new RegExp(`export const ${constName} = \\{([\\s\\S]*?)\\}\\s*as const[^;]*;`))
    ?? src.match(new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\]\\s*as const[^;]*;`));
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** 从 TS 源码抽取 `export type X = | 'a' | 'b' …;` 联合的全部单引号字面量 */
function extractUnionStrings(src, typeName) {
  const m = src.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function diff(label, actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (actualSet.size !== actual.length) failures.push(`${label}：存在重复项`);
  const missing = [...expectedSet].filter((x) => !actualSet.has(x));
  const extra = [...actualSet].filter((x) => !expectedSet.has(x));
  if (missing.length) failures.push(`${label}：缺 ${missing.join(', ')}`);
  if (extra.length) failures.push(`${label}：多 ${extra.join(', ')}`);
  return missing.length === 0 && extra.length === 0 && actualSet.size === actual.length;
}

// ———————————————————— 期望集（硬编码，锚见文件头）————————————————————

// 02 §3.4 IPC 契约表全量 24 行（通道名逐行抄录；前缀 constella:）
const EXPECTED_CHANNELS = [
  'constella:app:version', // r→m
  'constella:env:systemInfo', // r→m
  'constella:env:cdpProbe', // r→m
  'constella:shell:openExternal', // r→m
  'constella:dialog:openFile', // r→m
  'constella:dialog:saveFile', // r→m
  'constella:storage:invoke', // r→m
  'constella:secret:set', // r→m
  'constella:secret:get', // r→m
  'constella:secret:del', // r→m
  'constella:run:spawnScript', // r→m
  'constella:run:killScript', // r→m
  'constella:cdp:createSession', // r→m
  'constella:cdp:navigate', // r→m
  'constella:cdp:listSessions', // r→m
  'constella:cdp:openViewer', // r→m
  'constella:cdp:destroyRun', // r→m
  'constella:cron:upsert', // r→m
  'constella:cron:cancel', // r→m
  'constella:zip:export', // r→m
  'constella:zip:import', // r→m
  'constella:run:scriptEvent', // m→r 推送
  'constella:cron:fired', // m→r 推送
  'constella:app:confirmClose', // m→r 推送（带响应 {dirty}）
];
const EXPECTED_INVOKE = EXPECTED_CHANNELS.slice(0, 21);
const EXPECTED_PUSH = EXPECTED_CHANNELS.slice(21);

// 02 §6.1 错误码总表（7 通用 + 8 业务）
const EXPECTED_ERROR_CODES = [
  'VALIDATION-FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT-FOUND',
  'CONFLICT',
  'RATE-LIMITED',
  'INTERNAL',
  'AUTH-INVALID-CREDENTIALS',
  'AUTH-EMAIL-TAKEN',
  'AUTH-REFRESH-INVALID',
  'MARKET-PACKAGE-NOT-FOUND',
  'MARKET-PACKAGE-NOT-APPROVED',
  'MARKET-FILE-INVALID',
  'REVIEW-ALREADY-DONE',
  'ADMIN-USER-BANNED',
];

// 01 PRD-A4-01（L256）内置 12 type 清单（冻结）
const EXPECTED_BUILTIN_TYPE_IDS = [
  'trigger.manual',
  'trigger.cron',
  'cdp.open',
  'cdp.extract',
  'cdp.click',
  'http.request',
  'ai.llm',
  'data.transform',
  'logic.branch',
  'delay',
  'file.write',
  'human.review',
];

// X-01 §1 constants 行 storage DAO 业务错误码初集（全集随 M5 C-06 任务卡冻结）
const EXPECTED_DAO_ERROR_CODES = [
  'FLOW-NOT-FOUND',
  'VERSION-NOT-FOUND',
  'RUN-NOT-FOUND',
  'HIT-NOT-FOUND',
  'ACTIVE-RUN-EXISTS',
];

// T0-07 会签冻结 cdp 桥 9 method 白名单（CDP 全名，D.querySelector 补全为 DOM.querySelector）
const EXPECTED_BRIDGE_CDP_METHODS = [
  'Page.enable',
  'Page.navigate',
  'Runtime.evaluate',
  'DOM.getDocument',
  'DOM.querySelector',
  'DOM.getOuterHTML',
  'Input.dispatchMouseEvent',
  'Network.setCookie',
  'Network.getCookies',
];

// ———————————————————— 1. IPC 通道 ↔ 02 §3.4 ————————————————————

const channelsSrc = read('shared/src/ipc/channels.ts');
const channels = extractConstStrings(channelsSrc, 'IPC_CHANNELS');
const invoke = extractConstStrings(channelsSrc, 'IPC_INVOKE_CHANNELS');
const push = extractConstStrings(channelsSrc, 'IPC_PUSH_CHANNELS');
if (!channels || !invoke || !push) {
  failures.push('channels.ts：无法定位 IPC_CHANNELS/IPC_INVOKE_CHANNELS/IPC_PUSH_CHANNELS 声明块');
} else {
  const okAll = diff('IPC_CHANNELS ↔ 02 §3.4（24 通道）', channels, EXPECTED_CHANNELS);
  const okInv = diff('IPC_INVOKE_CHANNELS（21 r→m）', invoke, EXPECTED_INVOKE);
  const okPush = diff('IPC_PUSH_CHANNELS（3 m→r）', push, EXPECTED_PUSH);
  const noPrefix = channels.filter((c) => !c.startsWith('constella:'));
  if (noPrefix.length) failures.push(`IPC_CHANNELS：缺 constella: 前缀 → ${noPrefix.join(', ')}`);
  if (okAll && !noPrefix.length) console.log(`[ok] IPC 通道集合 ↔ 02 §3.4 逐行一致（${channels.length} 通道）`);
  if (okInv && okPush) console.log(`[ok] 方向划分＝21 r→m invoke + 3 m→r 推送`);
}

// ———————————————————— 2. 错误码 ↔ 02 §6.1 ————————————————————

const commonSrc = read('shared/src/dto/common.ts');
const errorCodesSrc = read('shared/src/constants/error-codes.ts');
const errorCodeUnion = extractUnionStrings(commonSrc, 'ErrorCode');
const errorCodeValues = extractConstStrings(errorCodesSrc, 'ERROR_CODES');
if (!errorCodeUnion || !errorCodeValues) {
  failures.push('无法定位 ErrorCode 联合（dto/common.ts）或 ERROR_CODES 常量（constants/error-codes.ts）');
} else {
  const okU = diff('dto ErrorCode 联合 ↔ 02 §6.1（15 项）', errorCodeUnion, EXPECTED_ERROR_CODES);
  const okV = diff('constants ERROR_CODES 值集 ↔ 02 §6.1（15 项）', errorCodeValues, EXPECTED_ERROR_CODES);
  if (okU && okV) console.log(`[ok] 错误码 ↔ 02 §6.1 逐项一致（dto 联合 + constants 常量双核对，${errorCodeValues.length} 项）`);
}

// ———————————————————— 3. BUILTIN_TYPE_IDS ↔ 01 A-4.01 ————————————————————

const builtinSrc = read('shared/src/constants/builtin-types.ts');
const builtin = extractConstStrings(builtinSrc, 'BUILTIN_TYPE_IDS');
if (!builtin) {
  failures.push('builtin-types.ts：无法定位 BUILTIN_TYPE_IDS 声明块');
} else {
  const ok = diff('BUILTIN_TYPE_IDS ↔ 01 A-4.01（12 type）', builtin, EXPECTED_BUILTIN_TYPE_IDS);
  if (ok) console.log(`[ok] BUILTIN_TYPE_IDS ↔ 01 PRD-A4-01 清单逐项一致（${builtin.length} type）`);
}

// ———————————————————— 增补 4. DAO 业务码初集 ————————————————————

const daoValues = extractConstStrings(errorCodesSrc, 'STORAGE_DAO_ERROR_CODES');
if (!daoValues) {
  failures.push('constants/error-codes.ts：无法定位 STORAGE_DAO_ERROR_CODES 声明块');
} else {
  const ok = diff('STORAGE_DAO_ERROR_CODES 初集（X-01 §1，5 项）', daoValues, EXPECTED_DAO_ERROR_CODES);
  if (ok) console.log(`[ok] storage DAO 业务错误码初集一致（${daoValues.length} 项）`);
}

// ———————————————————— 增补 5. cdp 桥 method 白名单 ————————————————————

const bridgeSrc = read('shared/src/ipc/bridge.ts');
const cdpMethods = extractConstStrings(bridgeSrc, 'BRIDGE_CDP_METHODS');
if (!cdpMethods) {
  failures.push('bridge.ts：无法定位 BRIDGE_CDP_METHODS 声明块');
} else {
  const ok = diff('BRIDGE_CDP_METHODS ↔ T0-07 会签（9 method）', cdpMethods, EXPECTED_BRIDGE_CDP_METHODS);
  if (ok) console.log(`[ok] cdp 桥 method 白名单 ↔ T0-07 冻结清单一致（${cdpMethods.length} method）`);
}

// ———————————————————— 汇总 ————————————————————

if (failures.length) {
  console.error('\ncheck-shared-consts FAIL：');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-shared-consts ok');

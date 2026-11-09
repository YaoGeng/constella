// preload 暴露键 ↔ IPC_CHANNELS ↔ 02 §3.4 三方一致性断言（T4-14 交付；口径 = TDD-C-M1 §6.6）。
//
// 用法：node scripts/check-ipc-surface.mjs（仓库根；任意 cwd 均可，路径按 import.meta.url 定位）
//   成功：逐项打印 [ok] 并输出 `check-ipc-surface ok`，exit 0
//   失败：打印全部差异项，exit 1
//
// 断言面（三方一致——preload 暴露键 ≡ X-01 IPC_CHANNELS ≡ 02 §3.4 全集 24 通道）：
//   1. shared/src/ipc/channels.ts：IPC_CHANNELS 键→值（驼峰别名→通道全名）；
//   2. client/src/preload/api.ts：PRELOAD_INVOKE_SURFACE（21 r→m）＋PRELOAD_PUSH_SURFACE（3 m→r）
//      ——键集 ∪ 恰等分 IPC_CHANNELS 键集、逐键值相等、方向子集与 IPC_INVOKE/PUSH_CHANNELS 一致；
//   3. docs/02-TDD-技术设计文档.md §3.4 表首列反引号通道名（+`constella:` 前缀）≡ IPC_CHANNELS 值集；
//   4. 无 Node 泄漏静态面（C-M1 §1 preload 面，02 §3.1 安全基线）：preload/api.ts 不得 import
//      electron/node: 内建（@constella/shared 只许 type-only——sandboxed preload 产物不可
//      require workspace 包，通道全名以字面量内联）；preload/index.ts 恒经
//      contextBridge.exposeInMainWorld('constella', createConstellaApi(ipcRenderer)) 装配。
// 运行时半段（Object.keys(api) ≡ 24 键）由 client/src/main/ipc/preload-transport.spec.ts 断言。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const read = (p) => {
  try {
    return readFileSync(path.join(repoRoot, p), 'utf8');
  } catch {
    failures.push(`无法读取 ${p}（前置文件缺失）`);
    return '';
  }
};

/** 抽取 `export const NAME = { key: 'value', … } as const` 块内的 键→'值' 对 */
function extractConstPairs(src, constName) {
  const m = src.match(new RegExp(`export const ${constName} = \\{([\\s\\S]*?)\\}\\s*as const`));
  if (!m) return null;
  const pairs = new Map();
  for (const hit of m[1].matchAll(/(\w+):\s*'([^']+)'/g)) pairs.set(hit[1], hit[2]);
  return pairs;
}

/** 抽取 `export const NAME = […] as const` 数组字面量全集 */
function extractConstArray(src, constName) {
  const m = src.match(new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\]\\s*as const`));
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function diffPairs(label, actual, expected) {
  const missing = [...expected.keys()].filter((k) => !actual.has(k));
  const extra = [...actual.keys()].filter((k) => !expected.has(k));
  const mismatched = [...expected.keys()].filter((k) => actual.has(k) && actual.get(k) !== expected.get(k));
  if (missing.length) failures.push(`${label}：缺键 ${missing.join(', ')}`);
  if (extra.length) failures.push(`${label}：多键 ${extra.join(', ')}`);
  if (mismatched.length) failures.push(`${label}：值不一致 ${mismatched.map((k) => `${k}→${actual.get(k)}（期望 ${expected.get(k)}）`).join(', ')}`);
  return missing.length === 0 && extra.length === 0 && mismatched.length === 0;
}

// ———————— ① X-01 IPC_CHANNELS（键→通道全名） ————————

const channelsSrc = read('shared/src/ipc/channels.ts');
const channels = extractConstPairs(channelsSrc, 'IPC_CHANNELS');
const invokeChannels = extractConstArray(channelsSrc, 'IPC_INVOKE_CHANNELS');
const pushChannels = extractConstArray(channelsSrc, 'IPC_PUSH_CHANNELS');
if (!channels || !invokeChannels || !pushChannels) {
  failures.push('shared/src/ipc/channels.ts：无法定位 IPC_CHANNELS/IPC_INVOKE_CHANNELS/IPC_PUSH_CHANNELS');
} else {
  console.log(`[ok] X-01 IPC_CHANNELS：${channels.size} 通道（${invokeChannels.length} r→m invoke ＋ ${pushChannels.length} m→r 推送）`);
}

// ———————— ② preload 暴露面（api.ts 两张冻结表，字面量形——sandboxed preload 内联要求） ————————

const apiSrc = read('client/src/preload/api.ts');
const invokeSurface = extractConstPairs(apiSrc, 'PRELOAD_INVOKE_SURFACE');
const pushSurface = extractConstPairs(apiSrc, 'PRELOAD_PUSH_SURFACE');
if (!invokeSurface || !pushSurface) {
  failures.push('client/src/preload/api.ts：无法定位 PRELOAD_INVOKE_SURFACE/PRELOAD_PUSH_SURFACE 冻结表');
} else if (channels) {
  // 逐键：preload 键 ≡ IPC_CHANNELS 别名键、通道全名值逐键相等
  const merged = new Map([...invokeSurface, ...pushSurface]);
  const okPairs = diffPairs('preload 暴露键 ↔ IPC_CHANNELS', merged, channels);
  // 方向子集：invoke 表值 ⊆ IPC_INVOKE_CHANNELS、push 表值 ⊆ IPC_PUSH_CHANNELS（恰等分）
  const invokeSet = new Set(invokeChannels ?? []);
  const pushSet = new Set(pushChannels ?? []);
  const badDirection = [
    ...[...invokeSurface.entries()].filter(([, v]) => !invokeSet.has(v)).map(([k, v]) => `invoke 表 ${k}→${v}`),
    ...[...pushSurface.entries()].filter(([, v]) => !pushSet.has(v)).map(([k, v]) => `push 表 ${k}→${v}`),
  ];
  if (badDirection.length) failures.push(`方向划分错误（invoke 表须 ⊆ 21 r→m、push 表须 ⊆ 3 m→r）：${badDirection.join('; ')}`);
  // createConstellaApi 返回字面量须逐一含 24 键（运行时键面=静态双保险；键集精确断言在 spec）
  const faceBody = apiSrc.slice(apiSrc.indexOf('export function createConstellaApi'));
  const literalKeys = new Set([...faceBody.matchAll(/^ {4}(\w+)[:(]/gm)].map((m) => m[1]));
  const literalMissing = [...channels.keys()].filter((k) => !literalKeys.has(k));
  if (literalMissing.length) failures.push(`createConstellaApi 暴露字面量：缺键 ${literalMissing.join(', ')}`);
  if (okPairs && !badDirection.length && !literalMissing.length) {
    console.log(`[ok] preload 暴露键 ≡ IPC_CHANNELS（${invokeSurface.size} invoke ＋ ${pushSurface.size} 推送，别名恒等＋方向划分一致）`);
  }
}

// ———————— ③ 02 §3.4 契约表（首列反引号通道名 + constella: 前缀） ————————

function extractDocChannels() {
  const doc = read('docs/02-TDD-技术设计文档.md');
  const start = doc.indexOf('### 3.4 IPC 契约表');
  const end = doc.indexOf('### 3.5', start);
  if (start < 0 || end < 0) return null;
  const table = doc.slice(start, end);
  const names = [];
  for (const line of table.split('\n')) {
    const cell = /^\|\s*`/.exec(line);
    if (cell === null) continue;
    const firstCell = line.split('|')[1] ?? '';
    for (const tok of firstCell.matchAll(/`([a-z]+:[A-Za-z][A-Za-z0-9]*)`/g)) names.push(`constella:${tok[1]}`);
  }
  return names;
}

const docChannels = extractDocChannels();
if (docChannels === null) {
  failures.push('docs/02-TDD-技术设计文档.md：未解析到 §3.4 IPC 契约表');
} else {
  const docSet = [...new Set(docChannels)].sort();
  const chanSet = channels ? [...channels.values()].sort() : [];
  const missing = chanSet.filter((c) => !docSet.includes(c));
  const extra = docSet.filter((c) => !chanSet.includes(c));
  if (missing.length) failures.push(`02 §3.4 表 ↔ IPC_CHANNELS：缺 ${missing.join(', ')}`);
  if (extra.length) failures.push(`02 §3.4 表 ↔ IPC_CHANNELS：多 ${extra.join(', ')}`);
  if (!missing.length && !extra.length) console.log(`[ok] 02 §3.4 契约表逐行一致（${docSet.length} 通道，前缀 constella:）`);
}

// ———————— ④ 无 Node 泄漏静态面（02 §3.1 安全基线） ————————

const nodeLeak = /from\s+'(electron|node:[^']+)'|require\('(electron|node:[^']+)'\)/.exec(apiSrc);
if (nodeLeak !== null) {
  failures.push(`preload/api.ts Node 泄漏：${nodeLeak[0]}（preload 白名单面只许 @constella/shared type-only）`);
} else {
  console.log('[ok] preload/api.ts 无 electron/node: import（纯类型消费，无 Node 泄漏）');
}

// @constella/shared 不得以值形式 import（sandboxed preload 产物不可 require workspace 包——
// esbuild packages:'external' 会外置之；type-only import 编译期擦除）
const valueImport = /import\s*\{[^}]*\}\s*from\s*'@constella\/shared/.exec(apiSrc);
if (valueImport !== null) {
  failures.push(`preload/api.ts 值形式 import @constella/shared：${valueImport[0]}（须 import type——通道全名以字面量内联）`);
} else {
  console.log('[ok] preload/api.ts 对 @constella/shared 仅 type-only import（通道字面量内联——sandbox 产物自包含）');
}

const preloadEntry = read('client/src/preload/index.ts');
const bridgeOk =
  /contextBridge\.exposeInMainWorld\(\s*'constella'\s*,\s*createConstellaApi\(\s*ipcRenderer\s*\)\s*\)/.test(preloadEntry);
if (!bridgeOk) {
  failures.push("preload/index.ts：须恒为 contextBridge.exposeInMainWorld('constella', createConstellaApi(ipcRenderer))");
} else {
  console.log("[ok] preload/index.ts 经 contextBridge.exposeInMainWorld('constella', createConstellaApi(ipcRenderer)) 装配");
}

// ———————— 汇总 ————————

if (failures.length) {
  console.error(`\ncheck-ipc-surface FAILED（${failures.length} 项差异）:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-ipc-surface ok');

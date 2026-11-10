// Constella 设置键集一致性断言脚本（T6-12 交付；TDD-C-11 §6.4——05 T6-12 卡验收命令）。
//
// 用法：node scripts/check-settings-keys.mjs（仓库根；任意 cwd 均可，路径按 import.meta.url 定位）
//   成功：打印各键集计数与并集对账 → `check-settings-keys ok`，exit 0
//   失败：打印差异（缺失键/多余键/计数不符），exit 1
//
// 断言面（§6.4「设置面控件键集 ≡ X-01 SettingsSchema 交互/背景/星野键集」）：
//   - X-01 侧＝shared/src/settings/settings-keys.ts 的 SettingsSchema 接口键名（键形单一来源）；
//     排除非 A-14 设置面控件的 AI 配置引用键（ai / market.baseUrl / ai.route——§6.4 断言面
//     为「交互/背景/星野键集」）。
//   - 设置面侧＝client/src/renderer/settings/settings-store.ts 的四个键分组常量
//     （INTERACTION_KEYS/BACKGROUND_KEYS/SKY_LAYER_KEYS/SKY_DENS_KEYS——组件渲染与
//     dispatcher 分发均由该常量驱动；settings-store.ts 内另有 TS 编译期穷尽断言双保险）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 非设置面控件键（AI 配置引用/V1.1 路由——02 §7.1 settings 行「AI 配置引用」） */
const NON_UI_KEYS = new Set(['ai', 'market.baseUrl', 'ai.route']);

/** UI 控件分组期望计数（03 TDD-C-11 §1：三开关/双值+视差/11 星野开关/7 密度——demo L758-786） */
const EXPECTED_COUNTS = {
  INTERACTION_KEYS: 3,
  BACKGROUND_KEYS: 2,
  SKY_TOGGLE_KEYS: 11,
  SKY_DENS_KEYS: 7,
};

/** 读文件剥行注释（键形文件无 URL/正则字面量，`//` 仅注释——安全） */
function readStripped(rel) {
  return readFileSync(path.join(repoRoot, rel), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/** 从 X-01 settings-keys.ts 提取 SettingsSchema 接口键名（键形单一来源） */
function schemaKeys() {
  const src = readStripped('shared/src/settings/settings-keys.ts');
  const start = src.indexOf('export interface SettingsSchema {');
  if (start === -1) throw new Error('X-01 settings-keys.ts 未找到 SettingsSchema 接口');
  const body = src.slice(start);
  const keys = [];
  for (const line of body.split('\n').slice(1)) {
    const close = line.match(/^}/); // 接口闭括号（顶层，无嵌套 interface——SettingsSchema 全标量/引用成员）
    if (close) break;
    const m = line.match(/^\s{2}(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*[?:]/);
    if (m) keys.push(m[1] ?? m[2]);
  }
  return keys;
}

/** 从 settings-store.ts 提取键分组常量数组字面量成员（行扫描：`export const NAME = [` 至 `] as const`） */
function groupKeys() {
  const lines = readStripped('client/src/renderer/settings/settings-store.ts').split('\n');
  const groups = {};
  for (const name of Object.keys(EXPECTED_COUNTS)) {
    const start = lines.findIndex((l) => l.includes(`export const ${name} = [`));
    if (start === -1) throw new Error(`settings-store.ts 未找到常量 ${name}`);
    const keys = [];
    let closed = false;
    for (const line of lines.slice(start)) {
      for (const m of line.matchAll(/'([^']+)'/g)) keys.push(m[1]);
      if (/]\s*as\s*const/.test(line)) {
        closed = true;
        break;
      }
    }
    if (!closed) throw new Error(`settings-store.ts 常量 ${name} 未闭合（缺 ] as const）`);
    groups[name] = keys;
  }
  return groups;
}

/** 通道 12 层键构成断言（SKY_LAYER_KEYS=11 星野开关＋parallax 视差——demo L2698/L2721 同集；
 *  spread 拼接形，静态断言其唯一来源=SKY_TOGGLE_KEYS＋'parallax'，防通道面与 UI 面漂移） */
function checkLayerKeys(failures) {
  const src = readStripped('client/src/renderer/settings/settings-store.ts');
  const expected = "export const SKY_LAYER_KEYS = [...SKY_TOGGLE_KEYS, 'parallax'] as const;";
  if (!src.includes(expected)) {
    failures.push(
      `SKY_LAYER_KEYS 构成失配（期望精确形「${expected}」——通道 12 键必须=11 星野开关＋parallax，demo L2721）`,
    );
  }
}

const failures = [];
const schema = schemaKeys();
const schemaUi = schema.filter((k) => !NON_UI_KEYS.has(k));

// schema 侧健全性：键不重复、排除键确在 schema（防 X-01 键名漂移后脚本静默失配）
if (new Set(schema).size !== schema.length) failures.push(`X-01 SettingsSchema 键重复：${schema}`);
for (const k of NON_UI_KEYS) {
  if (!schema.includes(k)) failures.push(`X-01 SettingsSchema 缺少非 UI 键 ${k}（排除清单失配）`);
}

const groups = groupKeys();
checkLayerKeys(failures);
const union = [];
for (const [name, keys] of Object.entries(groups)) {
  if (keys.length !== EXPECTED_COUNTS[name]) {
    failures.push(`${name} 计数 ${keys.length} ≠ 期望 ${EXPECTED_COUNTS[name]}（${keys.join(',')}）`);
  }
  union.push(...keys);
}

const unionSet = new Set(union);
if (unionSet.size !== union.length) {
  const seen = new Set();
  for (const k of union) {
    if (seen.has(k)) failures.push(`设置面键 ${k} 跨分组重复`);
    seen.add(k);
  }
}
for (const k of schemaUi) {
  if (!unionSet.has(k)) failures.push(`设置面缺失 X-01 UI 键：${k}`);
}
for (const k of union) {
  if (!schemaUi.includes(k)) failures.push(`设置面多余键（不在 X-01 UI 键集）：${k}`);
}

if (failures.length > 0) {
  console.error('[check-settings-keys] 键集不一致：');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`[ok] X-01 SettingsSchema UI 键 ${schemaUi.length} 个 ≡ 设置面控件分组并集 ${unionSet.size} 个`);
console.log(
  `[ok] UI 分组：${Object.entries(groups)
    .map(([n, ks]) => `${n}=${ks.length}`)
    .join(' / ')}（交互 3 / 背景 2 / 星野开关 11 / 密度 7）`,
);
console.log('[ok] 通道分组：SKY_LAYER_KEYS = 11 星野开关＋parallax（12 层键，demo L2721 同集）');
console.log('[ok] 非 UI 键排除：ai / market.baseUrl / ai.route（AI 配置引用——02 §7.1/§12.3）');
console.log('check-settings-keys ok');

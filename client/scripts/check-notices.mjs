// THIRD-PARTY-NOTICES 分发义务断言（T4-20 组收尾二 / TDD-C-M1 §6.1g——S-9 吸收）。
//
// 用法：node scripts/check-notices.mjs（或经 `pnpm -F ./client run build`——已入构建链，
//       位于 esbuild/vite 前置：义务断言不过即不产出分发物）
//   成功：逐项打印 [ok] 并输出 `check-notices ok`，exit 0
//   失败：打印全部缺口项，exit 1
//
// 断言面（§6.1g「NOTICE 文件存在且覆盖依赖清单」）：
//   1) client/THIRD-PARTY-NOTICES.md 存在；
//   2) 汇总表逐包覆盖 client/package.json dependencies + devDependencies 全量清单
//      （缺一即未覆盖——新增依赖后须 `pnpm -F ./client run notices` 重生成）；
//   3) 义务链点名（本卡入列断言）：esbuild（S-5 转译器）＋better-sqlite3（原生库）——
//      Electron 分发物的第三方义务链核心两项；
//   4) jszip 增补位预留（C-08/P5 落位后自动纳入断言 2 的覆盖面——S-6 冻结版 3.10.2）。
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const pkgPath = here('../package.json');
const noticePath = here('../THIRD-PARTY-NOTICES.md');

/** §6.1g 本卡点名入列的义务链核心项（Electron 打包产物必含） */
const NAMED_ENTRIES = ['esbuild', 'better-sqlite3'];

const failures = [];

if (!existsSync(noticePath)) {
  console.error(`[fail] THIRD-PARTY-NOTICES.md 不存在：${noticePath}——先 pnpm -F ./client run notices 生成`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const notice = readFileSync(noticePath, 'utf8');

// 汇总表行形：`| <包名> | <版本> | <许可证> | <来源> |`——按行首 `| name |` 命中
function noticeCovers(name) {
  return new RegExp(`^\\| ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`, 'm').test(notice);
}

for (const name of Object.keys(deps).sort((a, b) => a.localeCompare(b))) {
  if (noticeCovers(name)) {
    console.log(`[ok] NOTICE 覆盖 ${name} ${deps[name]}`);
  } else {
    failures.push(
      `[fail] NOTICE 未覆盖 ${name} ${deps[name]}——新增依赖后须 pnpm -F ./client run notices 重生成`,
    );
  }
}

for (const name of NAMED_ENTRIES) {
  if (noticeCovers(name)) {
    console.log(`[ok] 义务链点名 ${name}（§6.1g 本卡入列断言）`);
  } else {
    failures.push(`[fail] 义务链点名 ${name} 缺席（§6.1g：Electron 分发物第三方义务链核心项）`);
  }
}

// jszip 增补位（C-08/P5）：未安装前不断言（否则阻断构建）；落位后由上方覆盖断言自动收口
if (!('jszip' in deps)) {
  console.log('[ok] jszip 增补位预留（C-08/P5 落位后随覆盖断言自动入列——S-6 冻结版 3.10.2）');
}

if (failures.length > 0) {
  console.error(`check-notices FAILED（${failures.length} 项缺口）:`);
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log('check-notices ok');

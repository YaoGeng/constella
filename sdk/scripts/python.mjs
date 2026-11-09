// @constella/sdk —— py 解释器解析（T4-12；isomorphism/build-py 共用）。
//
// 口径（sdk/py/README.md 解释器留痕）：Windows PATH 上 `python` 为 WindowsApps store stub
// （不可用）——`py` 启动器解析唯一注册解释器 Python 3.12.10（S-4 锁定版）。非 win32 优先
// python3。只接受 requires-python（pyproject：>=3.12）满足的解释器；解析失败即报错退出
// （py 侧契约/打包验收无解释器不可跑，不静默降级）。
//
// 返回值为解释器可执行文件绝对路径（`py -3` 经 `sys.executable` 换真身）；后续一律以
// `[exe, '-I', '-X', 'utf8', <entry>]` 形参 spawn（S-4 冻结，不含启动器前缀）。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 候选序：win32 先 py 启动器（-3），其余平台先 python3；`python` 殿后（win32 上多为 store stub） */
const CANDIDATES =
  process.platform === 'win32'
    ? [
        ['py', ['-3']],
        ['python3', []],
        ['python', []],
      ]
    : [
        ['python3', []],
        ['python', []],
        ['py', ['-3']],
      ];

/**
 * 解析满足 requires-python（>=3.12，S-4 锁定 3.12.10）的 py 解释器。
 * @returns {{ exe: string, version: string }}
 */
export function resolvePython() {
  const problems = [];
  for (const [cmd, pre] of CANDIDATES) {
    let probe;
    try {
      probe = spawnSync(cmd, [...pre, '-c', 'import sys; print(sys.executable); print("%d.%d.%d" % sys.version_info[:3])'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 20_000,
      });
    } catch (e) {
      problems.push(`${cmd}: ${e.message}`);
      continue;
    }
    if (probe.status !== 0) {
      problems.push(`${cmd}: exit ${probe.status}${probe.error ? ` (${probe.error.message})` : ''}`);
      continue;
    }
    const [exeLine, verLine] = probe.stdout.trim().split('\n');
    const exe = exeLine?.trim();
    const version = verLine?.trim() ?? '';
    if (!exe || !existsSync(exe)) {
      problems.push(`${cmd}: sys.executable 异常 ${JSON.stringify(exe)}`);
      continue;
    }
    const [major, minor] = version.split('.').map(Number);
    if (major !== 3 || minor < 12) {
      problems.push(`${cmd}: ${version} 不满足 requires-python >=3.12`);
      continue;
    }
    return { exe, version };
  }
  throw new Error(`未找到可用的 py 解释器（>=3.12；sdk/py/README.md 解释器口径）：${problems.join('；')}`);
}

export { SDK_ROOT };

// 帧解析/对照工具（T4-12；isomorphism.mjs 与 esbuild-regression.mjs 共用——口径同
// test/contract.test.ts：result 剥 runtime、error 剥 stack；对照为结构深相等，
// 不依赖字段序——帧形冻结=字段集/帧序/exit，字段序非判据面）。
import { spawn } from 'node:child_process';

export const RUNTIME_KEYS = ['electron', 'execPath', 'node', 'sdkVersion']; // K-01 §1 冻结字段集
export const CHILD_TIMEOUT_MS = 15_000;

export function parseFrames(stdout) {
  const frames = [];
  const unparseable = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      const f = JSON.parse(line);
      if (typeof f === 'object' && f !== null && !Array.isArray(f)) frames.push(f);
      else unparseable.push(line);
    } catch {
      unparseable.push(line);
    }
  }
  return { frames, unparseable };
}

export function stripVolatile(frame) {
  const copy = { ...frame };
  if (copy.type === 'result') delete copy.runtime;
  if (copy.type === 'error') delete copy.stack;
  return copy;
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && deepEqual(a[k], b[k]));
}

/** 子进程 spawn＋超时强杀（win32 taskkill /T /F——S-4 结论）＋stdout/stderr 采集 */
export function runChild(cmd, args, env, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined && process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      } else if (child.pid !== undefined) {
        child.kill('SIGKILL');
      }
    }, CHILD_TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: err, timedOut });
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout: out, stderr: String(e), timedOut });
    });
  });
}

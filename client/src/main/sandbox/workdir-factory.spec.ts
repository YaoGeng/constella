// WorkdirFactory 用例（T4-16 / 02 §12.1 冻结布局：sandbox/<runId>/<nodeId>/{config.yaml,scripts/,vault.json,out/}
// ＋run 级 pid 标记面）。
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RUN_PIDS_MARKER, WorkdirFactory } from './workdir-factory';

function makeFactory() {
  const root = mkdtempSync(path.join(tmpdir(), 'constella-sandbox-'));
  return {
    root,
    factory: new WorkdirFactory({ sandboxRoot: root }),
    dispose: () => {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      } catch {
        /* 尽力清理 */
      }
    },
  };
}

describe('WorkdirFactory（02 §12.1 布局冻结）', () => {
  it('create：四件布局恰形（config.yaml/scripts/vault.json/out）', () => {
    const env = makeFactory();
    try {
      const layout = env.factory.create('r-1', 'n-1', 'factor: 3\n');
      expect(layout.root).toBe(path.join(env.root, 'r-1', 'n-1'));
      expect(existsSync(layout.configYamlFile)).toBe(true);
      expect(existsSync(layout.scriptsDir)).toBe(true);
      expect(existsSync(layout.outDir)).toBe(true);
      expect(existsSync(layout.vaultJsonFile)).toBe(true);
      expect(readFileSync(layout.configYamlFile, 'utf8')).toBe('factor: 3\n');
      expect(readFileSync(layout.vaultJsonFile, 'utf8')).toBe('{}'); // 工作副本缺省空仓
    } finally {
      env.dispose();
    }
  });

  it('create 幂等：重复创建补齐；vault.json 既有副本不覆盖、config.yaml 重写', () => {
    const env = makeFactory();
    try {
      env.factory.create('r-1', 'n-1', 'a: 1');
      const { vaultJsonFile } = env.factory.create('r-1', 'n-1', 'a: 2');
      expect(readFileSync(vaultJsonFile, 'utf8')).toBe('{}');
      expect(readFileSync(path.join(env.root, 'r-1', 'n-1', 'config.yaml'), 'utf8')).toBe('a: 2');
    } finally {
      env.dispose();
    }
  });

  it('id 净化：路径分隔/../空白 id 拒绝（防 workdir 逃逸）', () => {
    const env = makeFactory();
    try {
      expect(() => env.factory.create('r/../x', 'n')).toThrow(/runId/);
      expect(() => env.factory.create('r', 'n\\n')).toThrow(/nodeId/);
      expect(() => env.factory.create('r 1', 'n')).toThrow(/runId/);
    } finally {
      env.dispose();
    }
  });

  it('run 标记：addPid/removePid 往返；清空即删标记；损坏标记读空', () => {
    const env = makeFactory();
    try {
      env.factory.addPid('r-1', 100);
      env.factory.addPid('r-1', 200);
      env.factory.addPid('r-1', 100); // 去重
      expect(env.factory.readPids('r-1')).toEqual([100, 200]);
      env.factory.removePid('r-1', 100);
      expect(env.factory.readPids('r-1')).toEqual([200]);
      env.factory.removePid('r-1', 200);
      expect(existsSync(path.join(env.root, 'r-1', RUN_PIDS_MARKER))).toBe(false);
      expect(env.factory.readPids('r-none')).toEqual([]);
    } finally {
      env.dispose();
    }
  });

  it('listRunIds/removeRun：run 目录枚举与整删（孤儿清扫面）', () => {
    const env = makeFactory();
    try {
      env.factory.create('r-1', 'n-1');
      env.factory.create('r-2', 'n-1');
      expect(env.factory.listRunIds().sort()).toEqual(['r-1', 'r-2']);
      env.factory.removeRun('r-1');
      expect(env.factory.listRunIds()).toEqual(['r-2']);
    } finally {
      env.dispose();
    }
  });
});

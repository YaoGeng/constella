// WorkdirFactory —— 沙箱工作目录工厂（T4-16 / TDD-C-M1 §3 SandboxExecutor 行「workdir」＋
// 02 §12.1：`sandbox/<runId>/<nodeId>/{config.yaml,scripts/,vault.json,out/}`）。
//
// 冻结面（02 §12.1 布局）：
//   - 根＝<userData>/sandbox（AppRuntime 装配注入；factoryReset 全清归 T4-20）；
//   - 每节点一目录：config.yaml（req 携 configYaml 时落其原文，缺省空文件——布局恒含）＋
//     scripts/（ts 链=生成 entry＋esbuild bundle 产物；py 链=T4-17 包置入）＋vault.json
//     （工作副本，CONSTELLA_VAULT_PATH 指向；缺省 `{}`）＋out/（脚本产物目录）；
//   - runId/nodeId 进路径段——id 净化（[A-Za-z0-9._-]+，拒路径分隔/..）为自拟防御项留痕。
//
// 孤儿标记（自拟冻结留痕——02 §12.1「孤儿检测（runId 标记+启动清扫）」未定载体）：
// run 级标记文件 sandbox/<runId>/run.pids.json ＝ {pids:[...]}（spawn 追加/退出摘除/清空即删）；
// sweepOrphans 读标记杀残留 pid 树后清目录（启动时点无在跑 run——全部 run 目录均按陈旧处理，
// 存活集以外的删除）。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 沙箱根下的 run 级 pid 标记文件名（孤儿清扫数据源——见文件头） */
export const RUN_PIDS_MARKER = 'run.pids.json';

/** id 净化（路径段安全：拒分隔符/.. /空白） */
export function assertSafeId(id: string, what: 'runId' | 'nodeId'): void {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`WorkdirFactory：非法 ${what}（须 [A-Za-z0-9._-]+）: ${JSON.stringify(id)}`);
  }
}

/** 工作目录布局（02 §12.1 冻结四件） */
export interface WorkdirLayout {
  /** 沙箱节点工作目录根（=spawn cwd） */
  root: string;
  configYamlFile: string;
  scriptsDir: string;
  vaultJsonFile: string;
  outDir: string;
}

/** 构造依赖 */
export interface WorkdirFactoryDeps {
  /** 沙箱根（=userData/sandbox） */
  sandboxRoot: string;
}

export class WorkdirFactory {
  constructor(private readonly deps: WorkdirFactoryDeps) {}

  /** run 目录（sandbox/<runId>） */
  runDir(runId: string): string {
    assertSafeId(runId, 'runId');
    return path.join(this.deps.sandboxRoot, runId);
  }

  /** 节点工作目录（sandbox/<runId>/<nodeId>） */
  nodeDir(runId: string, nodeId: string): string {
    assertSafeId(nodeId, 'nodeId');
    return path.join(this.runDir(runId), nodeId);
  }

  /**
   * 创建节点工作目录（布局四件；已存在=幂等补齐——vault.json 不覆盖既有工作副本，
   * config.yaml 按 req 原子重写〔每 spawn 反映当前包级默认〕）。
   */
  create(runId: string, nodeId: string, configYaml?: string): WorkdirLayout {
    const root = this.nodeDir(runId, nodeId);
    const scriptsDir = path.join(root, 'scripts');
    const outDir = path.join(root, 'out');
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });
    const configYamlFile = path.join(root, 'config.yaml');
    writeFileSync(configYamlFile, configYaml ?? '', 'utf8');
    const vaultJsonFile = path.join(root, 'vault.json');
    if (!existsSync(vaultJsonFile)) writeFileSync(vaultJsonFile, '{}', 'utf8');
    return { root, configYamlFile, scriptsDir, vaultJsonFile, outDir };
  }

  /** 沙箱根下现存 run 目录名集（孤儿清扫候选） */
  listRunIds(): string[] {
    if (!existsSync(this.deps.sandboxRoot)) return [];
    return readdirSync(this.deps.sandboxRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  }

  /** 删除整个 run 目录（孤儿清扫/收尾） */
  removeRun(runId: string): void {
    rmSync(this.runDir(runId), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }

  /** run 标记：追加 pid */
  addPid(runId: string, pid: number): void {
    const pids = this.readPids(runId);
    if (!pids.includes(pid)) pids.push(pid);
    this.writePids(runId, pids);
  }

  /** run 标记：摘除 pid（清空即删标记文件——run 无在跑进程） */
  removePid(runId: string, pid: number): void {
    const pids = this.readPids(runId).filter((p) => p !== pid);
    this.writePids(runId, pids);
  }

  /** 读 run 标记 pid 集（无标记/损坏 → []） */
  readPids(runId: string): number[] {
    const file = path.join(this.runDir(runId), RUN_PIDS_MARKER);
    if (!existsSync(file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { pids?: unknown };
      return Array.isArray(parsed.pids) ? parsed.pids.filter((p): p is number => typeof p === 'number') : [];
    } catch {
      return []; // 损坏标记按无残留处理（清扫仍会删目录）
    }
  }

  private writePids(runId: string, pids: number[]): void {
    const file = path.join(this.runDir(runId), RUN_PIDS_MARKER);
    if (pids.length === 0) {
      rmSync(file, { force: true });
      return;
    }
    mkdirSync(this.runDir(runId), { recursive: true });
    writeFileSync(file, JSON.stringify({ pids }), 'utf8');
  }
}

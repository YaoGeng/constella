// StorageService —— storage:invoke 桥接＋factoryReset 编排（T4-20 / TDD-C-M1 §3 StorageService
// 组件行：`init(layer)`／`handle(op,args)`／`factoryReset()`；消费方=IpcGateway、C-11 危险区）。
//
// 职责：
//   - init(options)：C-06 open 装配序（StorageLayer.open——迁移前备份→迁移→preloadExamples
//     挂点→种子→ensureInitialVersions）＋storage:invoke / zip:export / zip:import 三通道挂载；
//   - handle(op,args)：31 op 透传 StorageOpsRegistry（IPC-UNKNOWN-OP／VALIDATION-FAILED／
//     DAO 业务码透传＝T1-07 三段）；settings.factoryReset 截获为全编排（下条）；
//   - factoryReset()：C-06 删库→重迁→重种（layer.factoryReset）后——清 node-types/sandbox/
//     backups 目录（不含 vault.bin——T4-15 冻结：密文仓不随重置清理）＋app.relaunch 重启
//     （01 A-14.3／02 §13.3；C-06 §1 settings 行明示归本卡）；
//   - close()：退出序末步（WAL checkpoint——WAL 模式连接关闭即检查点落盘）。
//
// main 内直调边界（§2）：StorageService 持有 StorageLayer，layer.dao/layer.ops 为 main 进程
// 内同进程调用面（非 IPC）——vault/cron/cdp 装配消费 layer.dao（T4-20 组装，production-assembly）。
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ERROR_CODES } from '@constella/shared/constants';
import type { DbEngine } from '../storage/engine/connection';
import { StorageLayer } from '../storage/storage-layer';
import { StorageError } from '../storage/dao/dao-error';
import type { StorageServiceSlot } from '../runtime/service-slots';
import type { InvokeRegistry } from '../runtime/domain-channels';
import { registerStorageInvokeChannel } from './storage-channels';
import { registerZipChannels, type ZipExportPipeline, type ZipImportPipeline } from './zip-channels';

/** factoryReset 目录清理面（userData 相对名；vault.bin 不在列——T4-15 冻结） */
export const FACTORY_RESET_DIR_NAMES = ['node-types', 'sandbox', 'backups'] as const;

/** factoryReset 编排消费的 app 面（生产=electron app——index.ts 装配注入；测试=mock 断言面） */
export interface StorageServiceAppFace {
  relaunch(): void;
  quit(): void;
}

/** 构造依赖 */
export interface StorageServiceDeps {
  /** 存储引擎（生产=SQLITE_ENGINE〔better-sqlite3，P-3 收窄处〕；测试可换 node:sqlite 备胎） */
  engine: DbEngine;
  /** userData 目录（库文件＋node-types/sandbox/backups 落点） */
  userDataDir: string;
  /** 通道注册面（生产=AppRuntime.ipc〔IpcGateway〕；测试=loop mock／直连 gateway） */
  registry: InvokeRegistry;
  /** factoryReset 编排 app 面（relaunch＋quit） */
  app: StorageServiceAppFace;
  /** zip:export 管线（C-08〔P5〕注入位；缺省=stub 骨架） */
  zipExport?: ZipExportPipeline;
  /** zip:import 管线（C-08〔P5〕注入位；缺省=stub 骨架） */
  zipImport?: ZipImportPipeline;
  /** 日志面（缺省 console.log——factoryReset 留痕） */
  log?: (...args: unknown[]) => void;
}

export class StorageService implements StorageServiceSlot {
  /** C-06 持久层（main 内直调面：layer.dao／layer.ops——§2 同进程调用） */
  readonly layer: StorageLayer;

  constructor(private readonly deps: StorageServiceDeps) {
    this.layer = new StorageLayer(deps.engine);
  }

  /** 启动序步骤 4（AppRuntime）：C-06 open 装配序＋三通道挂载（storage:invoke＋zip:*） */
  init(options: { preloadExamples: () => void | Promise<void> }): void {
    this.layer.open(this.deps.userDataDir, { preloadExamples: options.preloadExamples });
    registerStorageInvokeChannel(this, this.deps.registry);
    registerZipChannels({ export: this.deps.zipExport, import: this.deps.zipImport }, this.deps.registry);
  }

  /** storage:invoke 桥接面（§3 `handle(op,args)`）：31 op 透传＋factoryReset 全编排截获 */
  handle(op: string, args?: unknown): unknown {
    if (op === 'settings.factoryReset') {
      // 危险 op 截获：ops 表该项只做 C-06 半段（删库重迁重种），目录清理＋relaunch 归本组件
      // （§3 组件行）——args 形状与 ops 面同口径（无参 op 传参=VALIDATION-FAILED）
      if (args !== undefined) {
        throw new StorageError(
          ERROR_CODES.VALIDATION_FAILED,
          '存储操作参数校验失败（settings.factoryReset）：无参 op 不接受 args',
        );
      }
      this.factoryReset();
      return undefined;
    }
    return this.layer.ops.invoke(op, args);
  }

  /** factoryReset 编排（§3 组件行；C-11 危险区经 storage:invoke settings.factoryReset 触发） */
  factoryReset(): void {
    const log = this.deps.log ?? console.log;
    this.layer.factoryReset(); // C-06 半段：删库（含 -wal/-shm）→重迁→重种
    this.clearResetDirs(); // C-M1 半段：node-types/sandbox/backups 清空（vault.bin 除外）
    log(
      `[constella-main] factoryReset 完成：库已重迁重种，` +
        `${FACTORY_RESET_DIR_NAMES.join('/')} 目录已清空（vault.bin 保留——T4-15 冻结），app 即将重启`,
    );
    this.deps.app.relaunch(); // 退出后由 Electron 拉起新实例
    this.deps.app.quit(); // 触发 before-quit→退出序（killTree→销毁 lane 窗→WAL checkpoint）→退出→relaunch
  }

  /** 退出序末步：close（WAL checkpoint——连接关闭即检查点） */
  close(): void {
    this.layer.close();
  }

  // ————————————————————————————————————————————

  /** 清空 factoryReset 面三目录（保留空目录——T1-03 备份目录等运行时按需重建语义不变） */
  private clearResetDirs(): void {
    for (const name of FACTORY_RESET_DIR_NAMES) {
      const dir = path.join(this.deps.userDataDir, name);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
    }
  }
}

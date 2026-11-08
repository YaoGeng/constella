// StorageDao 聚合（T1-04/T1-05；C-06 §3 DAO×N 组件行——§1 op 表逐行对应）。
// 组件分组：分组一（T1-04）flows/versions/definitions/library；分组二（T1-05）
// runs+nodeRuns/lanes/logs/settings/hits/assetPackages/pendingPublish。
// 依赖注入：全部 DAO 持 ConnGetter（非连接实例）——factoryReset 换连接后零重建跟随。
import type { ConnGetter } from './dao-error';
import { FlowsDao } from './flows-dao';
import { VersionsDao } from './versions-dao';
import { DefinitionsDao } from './definitions-dao';
import { LibraryDao } from './library-dao';
import { NodeRunsDao, RunsDao } from './runs-dao';
import { LanesDao } from './lanes-dao';
import { LogsDao } from './logs-dao';
import { SettingsDao } from './settings-dao';
import { HitsDao } from './hits-dao';
import { AssetPackagesDao } from './asset-packages-dao';
import { PendingPublishDao } from './pending-publish-dao';

/** 11 个 DAO 组件（12 实体——runs 与 nodeRuns 同组） */
export interface StorageDao {
  flows: FlowsDao;
  versions: VersionsDao;
  definitions: DefinitionsDao;
  library: LibraryDao;
  runs: RunsDao;
  nodeRuns: NodeRunsDao;
  /** main 内部面（不进 IPC 白名单）：cdp:* handler 会话台账 */
  lanes: LanesDao;
  logs: LogsDao;
  settings: SettingsDao;
  hits: HitsDao;
  /** main 内部面：zip 解包登记（hash 防重） */
  assetPackages: AssetPackagesDao;
  pendingPublish: PendingPublishDao;
}

/** 按（引擎注入的）连接持有者装配全部 DAO */
export function createStorageDao(conn: ConnGetter): StorageDao {
  const nodeRuns = new NodeRunsDao(conn);
  return {
    flows: new FlowsDao(conn),
    versions: new VersionsDao(conn),
    definitions: new DefinitionsDao(conn),
    library: new LibraryDao(conn),
    runs: new RunsDao(conn, nodeRuns),
    nodeRuns,
    lanes: new LanesDao(conn),
    logs: new LogsDao(conn),
    settings: new SettingsDao(conn),
    hits: new HitsDao(conn),
    assetPackages: new AssetPackagesDao(conn),
    pendingPublish: new PendingPublishDao(conn),
  };
}

// admin 域 DTO（X-01 §1 dto 行；02 §6.3 admin 接口）。
// M4 收口增补项：ReviewQueueItem（#8②，S-03 §1 冻结形）/ AdminPackageDetail.versions 元素形
// （与 S-02 §1 detail versions 同形＝PackageVersionMeta）/ StatsOverview.daily7d 元素形（#8④，S-04 §1 冻结识）。
import type { PackageKind, PackageManifest } from '../manifest/package-manifest';
import type { MarketAuthor, PackageStatus, PackageVersionMeta } from './market';
import type { PermLabel } from './common';
import type { UserRole, UserStatus } from './user';

/** GET /admin/users 行元素（02 §6.3：{id,email,role,status,createdAt,packageCount}） */
export interface AdminUserRow {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  packageCount: number;
}

/** GET /admin/users → {items,total}（02 §6.3） */
export interface AdminUsersRes {
  items: AdminUserRow[];
  total: number;
}

/** POST /admin/users/:id/ban：{reason}（封禁禁登录，理由留痕；02 §6.3/§4 用户管理） */
export interface BanUserReq {
  reason: string;
}

/** 审核队列项（✅ M4 #8② 冻结形：{packageId,kind,name,summary,author,perms,sizeBytes,semver,createdAt}，
 * S-03 §1；02 §6.3 GET /admin/reviews?status=pending「待审包列表（含 perms/大小/作者）」） */
export interface ReviewQueueItem {
  packageId: string;
  kind: 'node' | 'pack' | 'flow'; // PackageKind 字面量（S-03 §1 冻结形原样展开）
  name: string;
  summary?: string;
  author: MarketAuthor;
  perms: PermLabel[];
  sizeBytes: number;
  semver: string;
  createdAt: string;
}

/** GET /admin/reviews → {items,total}（02 §6.3；items 元素＝ReviewQueueItem） */
export interface ReviewQueueRes {
  items: ReviewQueueItem[];
  total: number;
}

/** POST /admin/packages/:id/review：{action:'approve'|'reject',reason}（02 §6.3/§6.4 示例；
 * 错误码 REVIEW-ALREADY-DONE/NOT-FOUND；写 ReviewRecord） */
export interface ReviewDecision {
  action: 'approve' | 'reject';
  reason?: string;
}

/** POST /admin/packages/:id/review → {status}（02 §6.3） */
export interface ReviewDecisionRes {
  status: PackageStatus;
}

/** POST /admin/packages/:id/offline：{reason} → {status:'offline'}（02 §6.3；下架列表/下载立即屏蔽） */
export interface OfflinePackageReq {
  reason: string;
}

/** GET /admin/packages/:id → 包详情 + manifest 摘要 + 脚本清单 + 计量（02 §6.3）；
 * versions 元素形＝{semver,createdAt,sizeBytes,checksum}（M4 #8④同源，S-02 §1 同形）；
 * manifest＝上传包 manifest 原文（02 §7.2 PackageVersion.manifest），脚本清单＝manifest.scripts 映射键；
 * 下载预检已拆分 GET /api/admin/packages/:id/download（✅ M4 #9，S-03 §1）——预检走点对点接口，不入本形。 */
export interface AdminPackageDetail {
  id: string;
  kind: PackageKind;
  name: string;
  summary?: string;
  author: MarketAuthor;
  perms: PermLabel[];
  status: PackageStatus;
  downloadCount: number;
  installCount: number;
  starCount: number;
  updatedAt: string;
  versions: PackageVersionMeta[];
  manifest: PackageManifest;
}

/** 看板 7 日趋势元素（✅ M4 #8④ 冻结形：{date:'YYYY-MM-DD',downloads,installs}，S-04 §1；
 * 空日补零＝server 职责） */
export interface DailyStat {
  /** 'YYYY-MM-DD' */
  date: string;
  downloads: number;
  installs: number;
}

/** GET /admin/stats/overview（02 §6.3：{userCount,packageCount,pendingCount,downloadTotal,installTotal,daily7d}） */
export interface StatsOverview {
  userCount: number;
  packageCount: number;
  pendingCount: number;
  downloadTotal: number;
  installTotal: number;
  daily7d: DailyStat[];
}

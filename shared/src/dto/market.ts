// market 域 DTO（X-01 §1 dto 行；02 §6.2 market 接口/§6.4 响应示例）。
// 发布上传 202 形＝PublishAccepted（02 §6.4）；下载/安装/发布需登录、浏览匿名（00 v1.2 X-6）。
import type { PackageKind } from '../manifest/package-manifest';
import type { PermLabel } from './common';

/** 审核状态机（02 §5.2：pending → approved | rejected；approved → offline；JSON 小写字面量＝02 §6.4 示例口径） */
export type PackageStatus = 'pending' | 'approved' | 'rejected' | 'offline';

/** 脱敏作者（✅ M4 #8③：MarketListItem.author＝{id, name:email 本地部分}，S-02 §1 冻结识） */
export interface MarketAuthor {
  id: string;
  /** email 本地部分（@ 前段；脱敏） */
  name: string;
}

/** 广场列表项（02 §6.2 GET /market/packages items 元素、§6.4 示例形） */
export interface MarketListItem {
  id: string;
  kind: PackageKind;
  name: string;
  summary?: string;
  author: MarketAuthor;
  perms: PermLabel[];
  downloadCount: number;
  installCount: number;
  starCount: number;
  version: string;
  /** ISO 时间（02 §6.4 示例 "2026-11-08T02:11:00Z"） */
  updatedAt: string;
}

/** GET /market/packages 查询参（02 §6.2：kind=node|pack|flow&q=&sort=latest|downloads&page=&pageSize=） */
export interface MarketListQuery {
  kind?: PackageKind;
  q?: string;
  sort?: 'latest' | 'downloads';
  page?: number;
  pageSize?: number;
}

/** GET /market/packages → {items,total}（02 §6.2） */
export interface MarketListRes {
  items: MarketListItem[];
  total: number;
}

/** 包版本元信息（versions[] 元素形＝✅ M4 #8④ 同源：{semver,createdAt,sizeBytes,checksum}，
 * S-02 §1 detail versions 同形；02 §7.2 PackageVersion 列） */
export interface PackageVersionMeta {
  semver: string;
  createdAt: string;
  sizeBytes: number;
  /** zip SHA-256（幂等/校验，02 §7.2 checksum；形如 "sha256:ab12…"，02 §6.4） */
  checksum: string;
}

/** GET /market/packages/:id → 包详情 + versions[] + perms（02 §6.2；
 * perms＝manifest 类目推导权限标签） */
export interface PackageDetail extends MarketListItem {
  versions: PackageVersionMeta[];
}

/** POST /market/packages → 202 {packageId,status:'pending',perms,checksum}（02 §6.2/§6.4；
 * multipart：zip + {kind,name,summary}；幂等键 zip SHA-256） */
export interface PublishAccepted {
  packageId: string;
  status: 'pending';
  perms: PermLabel[];
  checksum: string;
}

/** GET /market/mine → 我发布的包及审核状态（02 §6.2；列表项 + 审核状态） */
export interface MarketMineItem extends MarketListItem {
  status: PackageStatus;
}

// AssetPackagesDao（T1-05；main 内部面——**不进 IPC 白名单**；02 §7.1 asset_packages）。
// zip:import handler（C-08/C-M1）解包登记＋content_hash 防重（幂等：同 hash 返回既有 id）。
// 本表仅登记；zip 解包与资产目录（node-types/）落盘归 C-08/C-M1，不归存储层。
import { newId, now, fromJson, type ConnGetter } from './dao-error';

export interface AssetPackageRow {
  id: string;
  nodeType: string;
  pkgVersion: string;
  contentHash: string;
  dir: string;
  manifest: unknown;
  createdAt: number;
}

export class AssetPackagesDao {
  constructor(private readonly conn: ConnGetter) {}

  /** 登记或复用（content_hash 幂等键：命中返回既有 id、不重复登记） */
  upsert(args: {
    nodeType: string;
    pkgVersion: string;
    contentHash: string;
    dir: string;
    manifest: unknown;
  }): { id: string; reused: boolean } {
    const db = this.conn();
    const existing = db
      .prepare('SELECT id, manifest FROM asset_packages WHERE content_hash = :hash')
      .get({ hash: args.contentHash }) as { id: string; manifest: string } | undefined;
    if (existing !== undefined) return { id: existing.id, reused: true };
    const id = newId();
    db.prepare(
      'INSERT INTO asset_packages (id, node_type, pkg_version, content_hash, dir, manifest, created_at) VALUES (:id, :node_type, :pkg_version, :content_hash, :dir, :manifest, :ts)',
    ).run({
      id,
      node_type: args.nodeType,
      pkg_version: args.pkgVersion,
      content_hash: args.contentHash,
      dir: args.dir,
      manifest: JSON.stringify(args.manifest),
      ts: now(),
    });
    return { id, reused: false };
  }

  listByType(nodeType: string): AssetPackageRow[] {
    const rows = this.conn()
      .prepare('SELECT id, node_type, pkg_version, content_hash, dir, manifest, created_at FROM asset_packages WHERE node_type = :t ORDER BY created_at DESC, rowid DESC')
      .all({ t: nodeType }) as unknown as Array<{
      id: string;
      node_type: string;
      pkg_version: string;
      content_hash: string;
      dir: string;
      manifest: string;
      created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      nodeType: r.node_type,
      pkgVersion: r.pkg_version,
      contentHash: r.content_hash,
      dir: r.dir,
      manifest: fromJson<unknown>(r.manifest, `asset_packages.manifest(${r.id})`),
      createdAt: r.created_at,
    }));
  }
}

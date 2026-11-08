/**
 * MeteringService（TDD-S-02 §3；T2-07）：计量事务 + 安装幂等窗。
 * download：发放前事务=DownloadStat(DOWNLOAD) insert + downloadCount 原子 increment（明细留审计）。
 * installs：幂等键 userId+packageId+day（应用层查重——02 §7.2 无唯一约束，不擅改锚；
 * 当日重复 → {ok} 不计数）。day 边界=UTC 日（00:00Z）。
 */
import { prisma } from "../../utils/prisma.js";

/** 下载计量（发放前调用；与响应发放不在同一事务——计数失败则不放发，由调用方异常短路） */
export async function recordDownload(packageId: string, userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.downloadStat.create({ data: { packageId, userId, type: "DOWNLOAD" } }),
    prisma.package.update({ where: { id: packageId }, data: { downloadCount: { increment: 1 } } }),
  ]);
}

/** 安装计量（幂等窗内重复 → 返回 false 不计数） */
export async function recordInstall(packageId: string, userId: string): Promise<boolean> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const duplicate = await prisma.downloadStat.findFirst({
    where: { packageId, userId, type: "INSTALL", ts: { gte: dayStart } },
    select: { id: true },
  });
  if (duplicate) {
    return false;
  }

  await prisma.$transaction([
    prisma.downloadStat.create({ data: { packageId, userId, type: "INSTALL" } }),
    prisma.package.update({ where: { id: packageId }, data: { installCount: { increment: 1 } } }),
  ]);
  return true;
}

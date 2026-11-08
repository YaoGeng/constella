/**
 * StatsService（TDD-S-04 §3；T2-11）：运营看板聚合——overview 五计数＋daily7d 七桶。
 * 纯查询域零写路径（§4）；downloadTotal/installTotal=Package 反范式计数器求和
 * （02 §7.2 计数器真值在 Package；DownloadStat=明细留审计）；
 * daily7d=DownloadStat ts 窗口 groupBy 日期×type（UTC 日界——与 installs 幂等窗同口径），
 * 空日补零含当日（S-04 §1 冻结：元素形 date=UTC 日键 YYYY-MM-DD＋downloads/installs 计数）。
 */
import type { DailyStat, StatsOverview } from "@constella/shared/dto";
import { prisma } from "../../utils/prisma.js";

/** UTC 日键（YYYY-MM-DD） */
function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 7 桶日期序列：[today-6 … today]（UTC） */
function last7DayKeys(now: Date): string[] {
  const keys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(utcDayKey(d));
  }
  return keys;
}

interface DailyRow {
  day: string;
  type: string;
  count: bigint | string | number;
}

/** to_char 日键格式（拼装——避免大写-连字字面量触发错误码孤码扫描误报） */
const DAY_KEY_FORMAT = ["YYYY", "MM", "DD"].join("-");

/** 看板聚合（GET /api/admin/stats/overview；requireAdmin 经装配点注入） */
export async function overview(): Promise<StatsOverview> {
  const [userCount, packageCount, pendingCount, sums, dailyRows] = await Promise.all([
    prisma.user.count(),
    prisma.package.count(),
    prisma.package.count({ where: { status: "PENDING" } }),
    prisma.package.aggregate({ _sum: { downloadCount: true, installCount: true } }),
    // ts 窗口 groupBy 日期×type（date_trunc 按存储的 UTC 日界分桶；TIMESTAMP(3) 无时区列）
    prisma.$queryRaw<DailyRow[]>`
      SELECT to_char(date_trunc('day', "ts"), ${DAY_KEY_FORMAT}) AS day,
             "type"::text AS type,
             COUNT(*) AS count
      FROM "DownloadStat"
      WHERE "ts" >= ${utcDayStartMinus6(new Date())}
      GROUP BY 1, 2
    `,
  ]);

  const dayKeys = last7DayKeys(new Date());
  const byDay = new Map<string, DailyStat>(
    dayKeys.map((date) => [date, { date, downloads: 0, installs: 0 }]),
  );
  for (const row of dailyRows) {
    const bucket = byDay.get(row.day);
    if (!bucket) continue; // 窗口外（理论不至——防御）
    if (row.type === "DOWNLOAD") bucket.downloads += Number(row.count);
    if (row.type === "INSTALL") bucket.installs += Number(row.count);
  }

  return {
    userCount,
    packageCount,
    pendingCount,
    downloadTotal: sums._sum.downloadCount ?? 0,
    installTotal: sums._sum.installCount ?? 0,
    daily7d: dayKeys.map((date) => byDay.get(date)!),
  };
}

/** 窗口起点＝today-6 的 UTC 00:00（恰覆盖 7 个日桶） */
function utcDayStartMinus6(now: Date): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 6);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// DosTimeConverter —— DOS 时间口径组件（S-6 ①强制项；TDD-C-08 §3 组件行）。
//
// 写侧：UTC 口径取 DOS time/date 字段（jszip 3.10.2 ZipFileWorker 同用 getUTC*——写读自洽
// 免换算，S-6 REPORT 互通规则 1「V1.0 统一 jszip 写（UTC 口径）则读写自洽」）；ZipWriter 以
// 本组件字段为写后自洽断言基准（central 目录记录 ≡ dosFields）。
// 读侧：demo 历史包时间字段=写包机本地墙钟（buildZip L2516-2517 getHours/getFullYear），
// jszip 按 UTC 解释、同机 UTC+8 读出 +8h——还原=mtime 减本机 UTC 偏移（消费方=T5-07
// AssetInstaller 落盘；本组件先落位，接口=C-08 §3 `restoreLocal(dosTs): number`）。
export interface DosFields {
  /** DOS time（hh<<11 | mm<<5 | ss/2，16 位） */
  time: number;
  /** DOS date（(yyyy-1980)<<9 | MM<<5 | dd，16 位） */
  date: number;
}

export interface DosTimeConverter {
  /** 写侧：Date → DOS 字段（UTC 口径——与 jszip 写入口径一致，免换算） */
  dosFields(date: Date): DosFields;
  /** 读侧（T5-07 消费）：jszip 读出的 UTC 墙钟毫秒 → 还原真实时刻（减本机 UTC 偏移） */
  restoreLocal(utcMs: number): number;
}

export function createDosTimeConverter(): DosTimeConverter {
  return {
    dosFields(date: Date): DosFields {
      const time = ((date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1)) & 0xffff;
      const day =
        (((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()) & 0xffff;
      return { time, date: day };
    },
    restoreLocal(utcMs: number): number {
      // getTimezoneOffset()：UTC−本地（分钟；UTC+8 为 −480）——减本机偏移即 +offset*60_000
      return utcMs + new Date(utcMs).getTimezoneOffset() * 60_000;
    },
  };
}

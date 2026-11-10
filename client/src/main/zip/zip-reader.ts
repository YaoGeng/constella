// ZipReader —— main 侧 zip 读组件（T5-07 / TDD-C-08 §3 ZipReader 组件行）。
//
// S-6 ③ 强制项：**读端统一 jszip**（loadAsync 唯一读入口）——demo reader（L2561）对 deflate
// 条目静默跳过、不可复用；正式版读端兼容 store+deflate（01 A-12.01 X-7：广场包可能被第三方
// 工具重打包）。jszip 收窄面=client/src/main/zip/（§6.8 grep 面——本文件与 zip-writer 同域）。
//
// 两面读取（安全序=12.2#4 先限值后解压）：
//   - open()/openBytes()：central 元信息面（经 T5-06 readCentralEntries——size/method 名录，
//     jszip loadAsync 补 dir/unixPermissions/date）→ validateMeta（炸弹/路径限值，解压前）
//   - readAll()/read()：逐条解压（jszip async——store/deflate 透明兼容）
// S-6 ① 读侧时间面：metas().date=jszip 按 UTC 解释的 DOS 时间（历史包=写包机本地墙钟错读），
// 消费方（AssetInstaller 落盘 mtime）经 DosTimeConverter.restoreLocal 减本机偏移还原。
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { readCentralEntries, type CentralEntry } from './zip-writer';

/** central＋jszip 合并条目元信息（校验器/落盘面输入；不解压数据） */
export interface ZipEntryMeta {
  name: string;
  /** 解压后尺寸（central 记录——zip 炸弹限值输入，解压前可知） */
  size: number;
  compressedSize: number;
  /** 压缩方法（0=store / 8=deflate） */
  method: number;
  /** 目录条目标记（第三方打包常见；readAll 跳过、metas 保留供校验器点名） */
  dir: boolean;
  /** Unix 权限位（jszip 解析 external attrs；symlink 判定=S_IFLNK 0xA000） */
  unixPermissions?: number;
  /** DOS 时间重建的 Date（jszip UTC 口径——历史包消费方须 restoreLocal 还原，S-6 ①） */
  date?: Date;
}

/** 打开的 zip 归档（元信息面＋惰性解压面） */
export interface ZipArchive {
  /** central 元信息（含 dir 条目——校验器全量输入） */
  metas(): ZipEntryMeta[];
  /** 单条解压（store/deflate 统一入口；缺条目大声失败） */
  read(name: string): Promise<Uint8Array>;
  /** 全量解压为 Map（跳过 dir 条目） */
  readAll(): Promise<Map<string, Uint8Array>>;
}

export interface ZipReader {
  /** 打开磁盘文件（central 元信息面——先限值后解压的安全序入口） */
  open(path: string): Promise<ZipArchive>;
  /** 从字节打开（token 复验/inspect 同字节流——防 readFile 双读间调包窗口） */
  openBytes(bytes: Uint8Array): Promise<ZipArchive>;
  /** §3 冻结组件级接口：read(path)——打开＋全量解压 Map */
  read(path: string): Promise<Map<string, Uint8Array>>;
}

export function createZipReader(): ZipReader {
  return {
    async open(path) {
      return this.openBytes(await readFile(path));
    },
    async openBytes(bytes) {
      // central 面经 T5-06 readCentralEntries（size/method——jszip 公开 API 不暴露 central 尺寸）。
      // metas 以 central **原始名**为权威：jszip 读端对 `../` 等路径攻击名做清洗（loadAsync 后
      // 键变 `evil.json`）——穿越检测（12.2#4）若依赖 jszip 键即漏检；central 记录保留原始名。
      const central = readCentralEntries(bytes);
      const centralByName = new Map<string, CentralEntry>(central.map((e) => [e.name, e]));
      const zip = await JSZip.loadAsync(bytes); // 唯一读入口（store+deflate 兼容——S-6 ③）
      const metas: ZipEntryMeta[] = central.map((c) => {
        // jszip 对清洗后同名条目可能合并/改名——按原始名查不到时元信息留空（安全违例条目
        // 在 validateMeta 即拒，不会走到解压面）
        const obj = zip.files[c.name];
        const unixPermissions = obj?.unixPermissions;
        return {
          name: c.name,
          size: c.size,
          compressedSize: c.compressedSize,
          method: c.method,
          dir: obj?.dir ?? false,
          unixPermissions: typeof unixPermissions === 'number' ? unixPermissions : undefined,
          date: obj?.date ?? undefined,
        };
      });
      const ensure = (name: string): JSZip.JSZipObject => {
        const obj = zip.files[name];
        if (obj === undefined) throw new Error(`ZipReader：包内缺条目 ${name}`);
        return obj;
      };
      return {
        metas: () => metas,
        async read(name) {
          const obj = ensure(name);
          if (obj.dir) throw new Error(`ZipReader：条目 ${name} 是目录条目`);
          return obj.async('uint8array');
        },
        async readAll() {
          const out = new Map<string, Uint8Array>();
          for (const [name, obj] of Object.entries(zip.files)) {
            if (obj.dir) continue; // 目录条目跳过（S-6 ② 写端已治；读端容忍第三方包目录条目）
            out.set(name, await obj.async('uint8array'));
          }
          return out;
        },
      };
    },
    async read(path) {
      return (await this.open(path)).readAll();
    },
  };
}

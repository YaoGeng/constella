// CRC32 自校验器（demo L2502-2510 移植——查表法，逐字节语义不变；02 §2.5「保留在 ZipPipeline
// 内作导出产物自校验」）：ZipWriter 产出后独立于 jszip 重算并与 central 目录记录比对，
// 导出产物完整性不依赖写库自身的正确性（T5-06 / TDD-C-08 §3 ZipWriter 组件行）。
// 查表法（demo 同构：懒建 256 项表；module 级单例）
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

/** CRC32（IEEE 802.3 多项式 0xEDB88320 反射式；返回无符号 32 位） */
export function crc32(u8: Uint8Array): number {
  let c = ~0;
  for (const byte of u8) {
    // 查表索引 (c^byte)&0xff 恒 ∈ [0,256)——表长 256，非空断言安全
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return ~c >>> 0;
}

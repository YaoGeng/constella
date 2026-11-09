// MockSafeStorage —— electron safeStorage 替身（T4-15 测试基建；卡面口径：safeStorage 经可注入面
// mock、不真启 electron——真 DPAPI/Keychain 头跑不在本卡断言面）。
//
// 加密替身语义：MAGIC 标记字节＋逐字节 XOR 掩码——明文子串不进密文/vault.bin（§6.4 grep 断言
// 对象）；decryptString 仅接受本替身加密的密文（MAGIC 校验），跨替身/损坏密文显式抛错
// （对齐真实 safeStorage 解密失败抛错面）。
import type { SafeStorageLike } from '../secret-vault';

/** 密文首字节标记（decryptString 校验——非本替身密文即拒） */
const MAGIC = 0xc0;
/** XOR 掩码字节（密文与明文字节逐位相异——明文子串零残留） */
const MASK = 0x5a;

export class MockSafeStorage implements SafeStorageLike {
  /** 可用性开关（false=降级面：isEncryptionAvailable() → false → SECRET-UNAVAILABLE） */
  available = true;
  encryptCount = 0;
  decryptCount = 0;

  isEncryptionAvailable(): boolean {
    return this.available;
  }

  encryptString(plainText: string): Buffer {
    this.encryptCount++;
    const bytes = Buffer.from(plainText, 'utf8');
    const out = Buffer.alloc(bytes.length + 1);
    out[0] = MAGIC;
    for (let i = 0; i < bytes.length; i++) {
      out[i + 1] = bytes[i]! ^ MASK;
    }
    return out;
  }

  decryptString(encrypted: Buffer): string {
    this.decryptCount++;
    if (encrypted.length === 0 || encrypted[0] !== MAGIC) {
      throw new Error('mock safeStorage: 无法解密（非本替身加密的密文）');
    }
    const body = encrypted.subarray(1);
    const plain = Buffer.alloc(body.length);
    for (let i = 0; i < body.length; i++) {
      plain[i] = body[i]! ^ MASK;
    }
    return plain.toString('utf8');
  }
}

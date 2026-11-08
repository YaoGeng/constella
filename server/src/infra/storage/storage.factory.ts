/**
 * StorageFactory：读 env 一次性构造单例（TDD-S-05 §3；T2-12）。
 * 装配点（src/index.ts）注入 S-02/S-03——域零感知实现（P-3 收窄）。
 * s3 驱动随 T2-13 落地（S3Storage + @aws-sdk；本卡仅 disk）。
 */
import { env } from "../../utils/env.js";
import { DiskStorage } from "./disk.storage.js";
import type { StorageAdapter } from "./storage.types.js";

let singleton: StorageAdapter | undefined;

export function getStorage(): StorageAdapter {
  if (singleton) {
    return singleton;
  }
  switch (env.STORAGE_DRIVER) {
    case "disk":
      singleton = new DiskStorage(env.STORAGE_DIR);
      return singleton;
    case "s3":
      // T2-13 接口位：S3Storage（@aws-sdk/client-s3 + presigner @3.1164.0 已预装）
      throw new Error("STORAGE_DRIVER=s3 is not implemented yet (lands with T2-13)");
    default: {
      const driver: never = env.STORAGE_DRIVER;
      throw new Error(`unknown STORAGE_DRIVER: ${String(driver)}`);
    }
  }
}

/** 仅测试用：重置单例（换驱动/目录后重新构造） */
export function resetStorageForTests(): void {
  singleton = undefined;
}

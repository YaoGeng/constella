/**
 * StorageFactory：读 env 一次性构造单例（TDD-S-05 §3；T2-12 disk/T2-13 s3）。
 * 装配点（src/index.ts）注入 S-02/S-03——域零感知实现（P-3 收窄：@aws-sdk import 仅在 infra/storage/）。
 */
import { env } from "../../utils/env.js";
import { DiskStorage } from "./disk.storage.js";
import { S3Storage } from "./s3.storage.js";
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
      // 必填项由 env schema superRefine 收口（STORAGE_DRIVER=s3 时缺项启动即 fail-fast）
      singleton = new S3Storage({
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION!,
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
        forcePathStyle: env.S3_FORCE_PATH_STYLE !== undefined
          ? env.S3_FORCE_PATH_STYLE === "true"
          : env.S3_ENDPOINT !== undefined, // 自定义 endpoint 默认路径风格（MinIO/COS/R2）
      });
      return singleton;
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

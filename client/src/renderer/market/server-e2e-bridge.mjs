// E2E server 桥（T5-11 §6.8）：字面量动态 import＝vite 解析（.js→.ts 映射）保持原样；
// 本文件为 .mjs——client tsc program 不跟随 server 源码（两端 tsconfig 严格度不同，
// server 类型检查归 server 套件；类型面见 server-e2e-bridge.d.mts）。
export async function loadAppModule() {
  return import('../../../../server/src/app.js');
}

export async function loadPrisma() {
  return import('../../../../server/src/utils/prisma.js');
}

export async function loadStorageFactory() {
  return import('../../../../server/src/infra/storage/storage.factory.js');
}

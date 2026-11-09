// zip:export / zip:import 通道 handler 骨架（T4-20 / TDD-C-M1 §1 矩阵 zip 行＋§3 IpcGateway
// 行「zip:* 装配位」——通道注册＋错误序列化归本卡；管线与 02 §12.2#4 安全校验本体=C-08 卡
// 〔P5 波〕，届时注入位替换 stub 并复跑 C-08 §6.7 断言〔05 T4-20 备注〕）。
//
// 错误面（§1 矩阵）：ZIP-WRITE-FAILED / ZIP-FLOW-NOT-FOUND（export 域）＋ZIP-INVALID /
// ZIP-UNSAFE-ENTRY（import 域）——ZipError（Error+string code 同构形）经 IpcGateway
// serializeError 归一 {code,message} reject（§1 错误序列化铁律）。
import { IPC_CHANNELS, IPC_ERROR_CODES, type IpcErrorCode } from '@constella/shared/ipc';
import type { ZipExportReq, ZipExportRes, ZipImportReq, ZipImportRes } from '@constella/shared/ipc';
import type { InvokeRegistry } from '../runtime/domain-channels';

/** zip:export 管线（C-08 注入位：两变体——流程导出 {flowId,savePath}｜发布打包 {types[],savePath,meta}） */
export type ZipExportPipeline = (req: ZipExportReq) => ZipExportRes | Promise<ZipExportRes>;

/** zip:import 管线（C-08 注入位：两段式——inspect→ImportSummary｜commit(token 复验)→{nodes[],noScript[]}） */
export type ZipImportPipeline = (req: ZipImportReq) => ZipImportRes | Promise<ZipImportRes>;

/** zip 域业务错误（ZIP_* 四码——经 IpcGateway serializeError 归一 {code,message}，§1 铁律） */
export class ZipError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipPipelines {
  /** zip:export 管线（缺省=stub：ZIP-WRITE-FAILED「管线未装配」） */
  export?: ZipExportPipeline;
  /** zip:import 管线（缺省=stub：ZIP-INVALID「管线未装配」） */
  import?: ZipImportPipeline;
}

/** 注册 zip:export / zip:import（StorageService.init 调用；重复注册由 IpcGateway 拒绝） */
export function registerZipChannels(pipelines: ZipPipelines, registry: InvokeRegistry): void {
  registry.handle(IPC_CHANNELS.zipExport, (payload) => {
    const impl = pipelines.export;
    if (impl === undefined) {
      // stub 骨架（T4-20）：管线本体=C-08〔P5〕注入位——未注入即 ZIP-WRITE-FAILED（写侧面不可达）
      throw new ZipError(
        IPC_ERROR_CODES.ZIP_WRITE_FAILED,
        'zip:export 管线未装配（C-08/P5 注入位——T4-20 stub 骨架，错误序列化已就位）',
      );
    }
    return impl(payload as ZipExportReq); // 形状已过 payload-schemas 双变体校验（T4-14）
  });
  registry.handle(IPC_CHANNELS.zipImport, (payload) => {
    const impl = pipelines.import;
    if (impl === undefined) {
      // stub 骨架：inspect/commit 均不可达——ZIP-INVALID（读侧面无法校验任何包）
      throw new ZipError(
        IPC_ERROR_CODES.ZIP_INVALID,
        'zip:import 管线未装配（C-08/P5 注入位——T4-20 stub 骨架，错误序列化已就位）',
      );
    }
    return impl(payload as ZipImportReq); // 形状已过 payload-schemas 两段式校验（T4-14）
  });
}

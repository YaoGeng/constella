// cdp 域通道业务错误（T4-18 / TDD-C-M1 §1 矩阵 Cdp 行错误码：CDP-PORT-EXHAUSTED/
// CDP-ATTACH-FAILED/CDP-SESSION-NOT-FOUND/CDP-NAV-FAILED）。
// 形=Error＋非空 string code（IpcGateway serialize-error 识别序 ②——DomainChannelError〔T4-13〕/
// StorageError〔T1-05〕同构形；经 IpcGateway 统一序列化 {code,message} reject）。
import type { IpcErrorCode } from '@constella/shared/ipc';

/** cdp 域业务错误（throw→IpcGateway 序列化为 {code,message} reject） */
export class CdpChannelError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CdpChannelError';
  }
}

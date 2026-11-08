// IPC 契约（X-01 §1/§3 ipc 组件）：IPC_CHANNELS（24 通道常量）+ 9 域 payload + IpcError/错误码集
// + bridge.ts（CapabilityBridge ws 帧协议，T0-07 会签冻结）。
export * from './app.payload';
export * from './bridge';
export * from './cdp.payload';
export * from './channels';
export * from './cron.payload';
export * from './dialog.payload';
export * from './env.payload';
export * from './run.payload';
export * from './secret.payload';
export * from './storage.payload';
export * from './zip.payload';

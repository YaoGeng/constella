// Constella client — preload 入口（T0-08 占位 → T4-14 收口为白名单完整面，TDD-C-M1 §1 preload 面）。
//
// sandboxed renderer 的 preload 只能以 CJS 加载（esbuild.mjs 固定 format:'cjs'）。
// 正式形态（本卡）：contextBridge 暴露 `window.constella`，白名单键 ≡ X-01 IPC_CHANNELS ≡
// 02 §3.4 全集（24 通道＝21 r→m invoke＋3 m→r 推送）；错误统一 {code,message} 序列化
// （api.ts normalizeIpcRejection——`Error invoking remote method` 前缀不泄漏）。
// 本文件=唯一 electron import 面（api.ts 纯类型零 electron/node——check-ipc-surface.mjs 静态断言，
// 无 Node 泄漏＝02 §3.1 安全基线）。
import { contextBridge, ipcRenderer } from 'electron';
import { createConstellaApi } from './api';

contextBridge.exposeInMainWorld('constella', createConstellaApi(ipcRenderer));

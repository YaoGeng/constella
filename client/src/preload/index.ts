// Constella client — preload 最小占位（T0-08 / TDD-C-M1 §1 preload 面）。
//
// sandboxed renderer 的 preload 只能以 CJS 加载（esbuild.mjs 固定 format:'cjs'）。
// 正式形态（P1 波 IpcGateway 落地）：contextBridge 暴露 window.constella，
// 白名单键 ≡ X-01 IPC_CHANNELS ≡ 02 §3.4 全集（24 通道），错误统一 {code,message} 序列化。
// 当前先空导出占位，不暴露任何 Node 能力（02 §3.1 安全基线：无 Node 泄漏）。

import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('constella', {});

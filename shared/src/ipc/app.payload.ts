// app/shell 域 payload（X-01 §1 ipc 行；02 §3.4；C-M1 §1 矩阵 AppRuntime 行）。
// ⚠ 落位注记：X-01 §1 ipc 文件清单（app/env/dialog/storage/secret/run/cdp/cron/zip 九域）未单列
// shell 文件——shell:openExternal 服务归属 AppRuntime（C-M1 §1/§3），故随 app 域落本文件（上报项，见任务汇报）。

/** app:version（r→m）：`{}` → {app,electron,chrome,node,platform}（02 §3.4；process.versions 聚合，B-9） */
export interface AppVersionReq {
  // 空 payload（02 §3.4 `{}`）
}

export interface AppVersionRes {
  app: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
}

/** app:confirmClose（m→r，带响应）：`{}` → {dirty}（02 §3.4；main 拦截主窗 close → 问 renderer
 * dirty → 原生 dialog.showMessageBox 确认，02 §3.3） */
export interface ConfirmCloseReq {
  // 空 payload（02 §3.4 `{}`）
}

export interface ConfirmCloseRes {
  dirty: boolean;
}

/** shell:openExternal（r→m）：{url} → void（02 §3.4；外部链接安全打开，仅 http/https；
 * 协议白名单＝C-M1 冻结安全增强（M4 P2-9），错误码 SHELL-INVALID-URL） */
export interface ShellOpenExternalReq {
  url: string;
}

// dialog 域 payload（X-01 §1 ipc 行；02 §3.4 dialog:openFile / dialog:saveFile；
// C-M1 §1：in-band——用户取消→{path:null}，非 reject）。

/** 文件类型过滤器（Electron dialog filters 元素形） */
export interface FileFilter {
  name?: string;
  extensions: string[];
}

/** dialog:openFile（r→m）：{filters} → {path}（02 §3.4；zip 导入、demo 存档迁移文件选择） */
export interface OpenFileReq {
  filters?: FileFilter[];
}

export interface OpenFileRes {
  /** 用户取消＝null（in-band） */
  path: string | null;
}

/** dialog:saveFile（r→m）：{defaultName} → {path}（02 §3.4；zip 导出保存——
 * 默认名 constella-<流程名>.zip 语义归 C-08） */
export interface SaveFileReq {
  defaultName?: string;
}

export interface SaveFileRes {
  /** 用户取消＝null（in-band） */
  path: string | null;
}

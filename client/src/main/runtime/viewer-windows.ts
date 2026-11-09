// 查看窗原语（T4-13 / TDD-C-M1 §3 AppRuntime 行：openViewer/置顶/✕ 只关窗——交面给 T4-18 消费）。
//
// 语义（02 §3.4 cdp:openViewer 行＋A-8.2）：同 laneKey 已开 → 置顶（focus+moveTop，不重载）；
// 未开 → 创建可见窗口加载 url；✕ 关窗＝默认 close（无拦截——只关查看窗不中断自动化）。
// 窗口承载的 partition/与 lane 会话窗的联动归 T4-18 CdpSessionManager（本卡只交窗口原语）。
import type { BrowserWindowConstructor, BrowserWindowLike } from './electron-api';

/** 查看窗打开请求（lane 会话投影窗；加载 URL 由 T4-18 CdpSessionManager 决定） */
export interface OpenViewerOptions {
  /** lane 会话键（同 lane 复用已开查看窗——置顶） */
  laneKey: string;
  /** 查看窗加载的页面 URL */
  url: string;
}

export class ViewerWindowManager {
  /** laneKey → 查看窗（closed 后剔除；再开重建） */
  private readonly byLaneKey = new Map<string, BrowserWindowLike>();

  constructor(private readonly browserWindow: BrowserWindowConstructor) {}

  /** 打开/置顶查看窗（T4-18 cdp:openViewer 消费面） */
  openViewer(options: OpenViewerOptions): BrowserWindowLike {
    const existing = this.byLaneKey.get(options.laneKey);
    if (existing !== undefined && !existing.isDestroyed()) {
      existing.focus();
      existing.moveTop();
      return existing;
    }
    const win = new this.browserWindow({
      show: true,
      width: 1280,
      height: 800,
      webPreferences: {
        // 查看窗加载外部页面：与主窗同一安全基线（02 §3.1；无 preload、无 Node 面）
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    this.byLaneKey.set(options.laneKey, win);
    win.on('closed', () => {
      if (this.byLaneKey.get(options.laneKey) === win) this.byLaneKey.delete(options.laneKey);
    });
    void win.loadURL(options.url).catch((err: unknown) => {
      console.error('[constella-main] 查看窗加载失败:', err);
    });
    return win;
  }

  /** 当前打开的查看窗数（测试/T4-18 观测面） */
  get openCount(): number {
    let n = 0;
    for (const win of this.byLaneKey.values()) if (!win.isDestroyed()) n++;
    return n;
  }
}

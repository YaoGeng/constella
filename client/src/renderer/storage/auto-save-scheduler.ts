// AutoSaveScheduler —— 800ms 防抖自动保存（T1-08；C-06 §3 renderer 行；02 §3.3；demo L1299-1311）。
//
// schedule()=flowStore markDirty 回调挂点（P-3：不 import C-01）；800ms 内多次 markDirty 合并
// 为一次保存；settings.autoSave 门控（isEnabled 注入——关→schedule 即拒、pending 取消，且
// 触发时点二次核验防竞态）；flush()=关窗前冲刷（app:confirmClose 链路，C-M1/P4 接线）。
// 防抖触发路径的保存错误吞掉并 console.error（fire-and-forget；flush 路径错误上抛由调用方处理）。
export interface AutoSaveSchedulerOptions {
  /** 防抖窗（默认 800ms，02 §3.3） */
  delayMs?: number;
  /** settings.autoSave 门控读取（注入——C-11 设置面/flowStore） */
  isEnabled(): boolean;
  /** 保存动作（注入——通常为 SaveOrchestrator.doSave(true, ctx)） */
  onSave(): void | Promise<void>;
}

export class AutoSaveScheduler {
  private readonly delayMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: AutoSaveSchedulerOptions) {
    this.delayMs = opts.delayMs ?? 800;
  }

  /** markDirty 挂点：重置防抖窗（合并多次脏标记）；门控关→清 pending 拒排程 */
  schedule(): void {
    if (!this.opts.isEnabled()) {
      this.cancel();
      return;
    }
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.fire(false);
    }, this.delayMs);
  }

  /** 取消排程（不触发保存） */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 关窗前冲刷：pending 即刻保存并等待完成（错误上抛由调用方处置）；无 pending 无动作 */
  async flush(): Promise<void> {
    if (this.timer === null) return;
    this.cancel();
    await this.fire(true);
  }

  get isPending(): boolean {
    return this.timer !== null;
  }

  /** 触发（门控二次核验）。rethrow=true（flush 链路）错误上抛；false（防抖定时器路径）
   *  吞掉并 console.error——fire-and-forget 不产生未处理拒绝 */
  private async fire(rethrow: boolean): Promise<void> {
    if (!this.opts.isEnabled()) return;
    try {
      await this.opts.onSave();
    } catch (err) {
      if (rethrow) throw err;
      console.error('[AutoSaveScheduler] 自动保存失败：', err);
    }
  }
}

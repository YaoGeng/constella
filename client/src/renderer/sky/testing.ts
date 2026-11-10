// C-12 测试工具（TDD-C-12 §6.1「canvas mock」宿主）——仅测试消费，非模块面。
// 零 vitest import：全部以普通赋值 + 手工 restore 实现，供各 spec 复用。
// RecordingContext 记录全部 2D 调用为可 JSON 序列化条目（图像→数字 id、渐变→id+addColorStop），
// 支撑 §6.2 的「固定种子确定性 golden 快照」等价交付（jsdom 无真像素比对——PM 默认口径）。

export type Op = [string, ...unknown[]];

// 图像编号按「每个 ctx 的绘制顺序」局部分配（全局递增会让第二座挂载的 op 流漂移——golden 需只依赖顺序）
export class RecordingContext {
  readonly ops: Op[] = [];
  private gSeq = 0;
  private imgSeq = 0;
  private readonly imgIds = new WeakMap<object, number>();

  private imgId(img: object): number {
    let id = this.imgIds.get(img);
    if (id === undefined) { id = ++this.imgSeq; this.imgIds.set(img, id); }
    return id;
  }

  // —— 属性（setter 记录） ——
  set fillStyle(v: string | CanvasGradient) { this.ops.push(['fillStyle', v]); }
  set strokeStyle(v: string | CanvasGradient) { this.ops.push(['strokeStyle', v]); }
  set lineWidth(v: number) { this.ops.push(['lineWidth', v]); }
  set lineCap(v: string) { this.ops.push(['lineCap', v]); }
  set globalAlpha(v: number) { this.ops.push(['globalAlpha', v]); }
  set globalCompositeOperation(v: string) { this.ops.push(['gco', v]); }
  set filter(v: string) { this.ops.push(['filter', v]); }
  set imageSmoothingEnabled(v: boolean) { this.ops.push(['imageSmoothingEnabled', v]); }
  set imageSmoothingQuality(v: string) { this.ops.push(['imageSmoothingQuality', v]); }

  setTransform(...a: number[]) { this.ops.push(['setTransform', ...a]); }
  translate(...a: number[]) { this.ops.push(['translate', ...a]); }
  rotate(...a: number[]) { this.ops.push(['rotate', ...a]); }
  scale(...a: number[]) { this.ops.push(['scale', ...a]); }
  save() { this.ops.push(['save']); }
  restore() { this.ops.push(['restore']); }
  beginPath() { this.ops.push(['beginPath']); }
  arc(...a: number[]) { this.ops.push(['arc', ...a]); }
  fill() { this.ops.push(['fill']); }
  fillRect(...a: number[]) { this.ops.push(['fillRect', ...a]); }
  moveTo(...a: number[]) { this.ops.push(['moveTo', ...a]); }
  lineTo(...a: number[]) { this.ops.push(['lineTo', ...a]); }
  stroke() { this.ops.push(['stroke']); }
  clearRect(...a: number[]) { this.ops.push(['clearRect', ...a]); }
  drawImage(img: CanvasImageSource, ...a: number[]) { this.ops.push(['drawImage', this.imgId(img as object), ...a]); }
  putImageData(img: ImageData, ...a: number[]) { this.ops.push(['putImageData', img.width, img.height, ...a]); }

  createImageData(w: number, h: number): ImageData {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h, colorSpace: 'srgb' } as ImageData;
  }
  private gradient(op: string, a: number[]): { addColorStop: (stop: number, color: string) => void } {
    const gid = ++this.gSeq;
    this.ops.push([op, gid, ...a]);
    return { addColorStop: (stop, color) => { this.ops.push(['addColorStop', gid, stop, color]); } };
  }
  createRadialGradient(...a: number[]) { return this.gradient('createRadialGradient', a); }
  createLinearGradient(...a: number[]) { return this.gradient('createLinearGradient', a); }

  count(name: string): number { return this.ops.filter(op => op[0] === name).length; }
}

/** patch HTMLCanvasElement.prototype.getContext → 每 canvas 独享 RecordingContext（jsdom 原生返回 null） */
export function patchCanvas2D(): { restore(): void; ctxOf(c: HTMLCanvasElement): RecordingContext; all(): RecordingContext[] } {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (type: string, ...rest: unknown[]) => RenderingContext | null;
  };
  const orig = proto.getContext;
  const perCanvas = new WeakMap<HTMLCanvasElement, RecordingContext>();
  const created: RecordingContext[] = [];
  proto.getContext = function (this: HTMLCanvasElement, type: string) {
    if (type === '2d') {
      let ctx = perCanvas.get(this);
      if (!ctx) { ctx = new RecordingContext(); perCanvas.set(this, ctx); created.push(ctx); }
      return ctx as unknown as CanvasRenderingContext2D;
    }
    return orig.call(this, type) as RenderingContext | null;
  };
  return {
    restore() { proto.getContext = orig; },
    ctxOf(c) { const ctx = perCanvas.get(c); if (!ctx) throw new Error('no mock ctx for canvas'); return ctx; },
    all() { return created.slice(); },
  };
}

/** 手动 rAF 泵（确定性时间步） */
export function installRaf(): {
  pump(t: number): void; queued(): number; cancelled(): number[]; restore(): void;
} {
  const w = window as unknown as Record<string, unknown>;
  const origRaf = w.requestAnimationFrame as typeof window.requestAnimationFrame;
  const origCancel = w.cancelAnimationFrame as typeof window.cancelAnimationFrame;
  let next = 1;
  const queue: ((t: number) => void)[] = [];
  const cancelled: number[] = [];
  w.requestAnimationFrame = (cb: (t: number) => void) => { queue.push(cb); return next++; };
  w.cancelAnimationFrame = (id: number) => { cancelled.push(id); };
  return {
    pump(t) { const q = queue.splice(0); for (const cb of q) cb(t); },
    queued() { return queue.length; },
    cancelled() { return cancelled.slice(); },
    restore() { w.requestAnimationFrame = origRaf; w.cancelAnimationFrame = origCancel; },
  };
}

/** matchMedia stub（vitest jsdom 非 pretendToBeVisual 无 matchMedia；默认 matches=false） */
export function installMatchMedia(matches: boolean): { restore(): void } {
  const w = window as unknown as Record<string, unknown>;
  const orig = w.matchMedia as typeof window.matchMedia | undefined;
  w.matchMedia = (q: string) =>
    ({ matches, media: q, onchange: null,
       addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
       dispatchEvent: () => false }) as unknown as MediaQueryList;
  return {
    restore() {
      if (orig) w.matchMedia = orig;
      else delete w.matchMedia;
    },
  };
}

/** Math.random 种子化（场景实体确定性；还原返回闭包） */
export function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seedMathRandom(seed: number): () => void {
  const orig = Math.random;
  Math.random = mulberry32(seed);
  return () => { Math.random = orig; };
}

/** FNV-1a 32bit（golden 快照摘要；hex 8 位） */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
export function hashCtxs(ctxs: RecordingContext[]): string {
  return fnv1a(ctxs.map(c => JSON.stringify(c.ops)).join('|'));
}

/** 建挂载用 canvas（id=sky，入 DOM——pointerdown 交互用例需真实冒泡路径） */
export function makeSkyCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.id = 'sky';
  document.body.appendChild(c);
  return c;
}

/** 每用例收尾：通道全局、DOM、遗留样式标签 */
export function resetSkyGlobals(): void {
  const w = window as unknown as { __skyCtl?: unknown; __skyReady?: unknown };
  delete w.__skyCtl;
  delete w.__skyReady;
  document.body.innerHTML = '';
  document.querySelectorAll('style[data-constella-sky],style[data-constella-sky-motion]').forEach(el => el.remove());
}

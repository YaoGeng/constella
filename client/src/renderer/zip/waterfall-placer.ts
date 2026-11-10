// WaterfallPlacer —— 视口中心瀑布坐标（T5-07 / TDD-C-08 §3 组件行）。
//
// demo L2629-2630 参照非权威：`x=Math.round(base.x-NODE_W/2+i*36), y=Math.round(base.y-30+i*40)`
// ——每项右移 36px/下移 40px；首节点经 NODE_W/2（demo L1329 NODE_W=192）与 -30 锚定视口中心。
// 复用处（§3）：ImportOrchestrator（zip 导入）、C-09 FlowInstaller（流程安装）。
// P-3：视口中心经注入（应用壳 ReactFlow screenToFlowPosition——与 CanvasSink.viewportCenter 同源）。
export const WATERFALL_DX = 36;
export const WATERFALL_DY = 40;
/** demo L1329 NODE_W=192（首节点中心锚定横偏移半宽） */
const NODE_W = 192;
/** demo L2630 纵向锚定偏移（-30） */
const Y_ANCHOR = 30;

export interface WaterfallPlacerDeps {
  /** 视口中心世界坐标（应用壳装配注入——调用时取值） */
  viewportCenter(): { x: number; y: number };
}

export interface WaterfallPlacer {
  /** §3 冻结组件级接口：positions(n)——n 个瀑布坐标（首项=视口中心锚定） */
  positions(n: number): { x: number; y: number }[];
}

export function createWaterfallPlacer(deps: WaterfallPlacerDeps): WaterfallPlacer {
  return {
    positions(n) {
      const base = deps.viewportCenter();
      const out: { x: number; y: number }[] = [];
      for (let i = 0; i < n; i++) {
        out.push({
          x: Math.round(base.x - NODE_W / 2 + i * WATERFALL_DX),
          y: Math.round(base.y - Y_ANCHOR + i * WATERFALL_DY),
        });
      }
      return out;
    },
  };
}

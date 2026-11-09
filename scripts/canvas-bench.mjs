#!/usr/bin/env node
// canvas-bench.mjs —— 画布性能 bench（T3-08 收尾；C-01 §6.3；S-1 同口径：
// 200 节点/500 边全自定义类型、MiniMap 常开、脚本化驱动 8s×3 场景，最差秒 fps ≥30。
// S-1 spike 实测基线 51.9fps〔spikes/s1-canvas/results/bench-*.json 留档〕——判据锚 02 §15.3）。
//
// 用法：node scripts/canvas-bench.mjs（仓库根）
//   场景：①大文档初始渲染稳定帧（挂载后 8s 采样）②持续节点位移（每 rAF tick setNodes 驱动重渲染）
//         ③持续 viewport pan（每 rAF tick setViewport）
//   采样：rAF 循环逐秒计帧，取全程最差完整秒。
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(repoRoot, 'client');
const requireFromClient = createRequire(path.join(clientDir, 'package.json'));
const { _electron: electron } = requireFromClient('playwright-core');

const NODES = 200;
const EDGES = 500;
const SCENE_MS = 8000;
const FPS_FLOOR = 30;

/** 200 节点/500 边生成（网格布点，边按序连接——S-1 同构负载）。 */
function buildDoc() {
  const nodes = [];
  for (let i = 0; i < NODES; i++) {
    nodes.push({
      id: `n${i}`,
      type: 'llm.chat',
      name: `节点${i}`,
      position: { x: (i % 20) * 220, y: Math.floor(i / 20) * 140 },
      params: { k: i },
    });
  }
  const edges = [];
  for (let i = 0; i < EDGES; i++) {
    const from = i % NODES;
    const to = (from + 1 + Math.floor(i / NODES)) % NODES;
    if (from === to) continue;
    edges.push({ id: `e${i}`, from: [`n${from}`, 'out'], to: [`n${to}`, 'in'] });
  }
  return { id: 'bench', name: 'bench', nodes, edges };
}

async function main() {
  const build = spawnSync('pnpm', ['-F', './client', 'build'], { cwd: repoRoot, stdio: 'pipe', shell: true });
  if (build.status !== 0) {
    console.error(build.stderr?.toString());
    process.exit(1);
  }
  const app = await electron.launch({ args: ['.'], cwd: clientDir });
  try {
    const page = await app.firstWindow();
    await page.evaluate(() => {
      window.location.hash = '#e2e';
      window.location.reload();
    });
    await page.waitForFunction(() => Boolean(window.__CONSTELLA_E2E__), null, { timeout: 15000 });
    await page.evaluate((doc) => window.__CONSTELLA_E2E__.loadFlow('bench', doc), buildDoc());
    await page.waitForSelector('.cn-node');
    await page.waitForTimeout(1200); // 首帧稳定

    /** 页面侧装配：rAF 计帧器 + setInterval 驱动器（后台节流不挂死——Node 侧逐秒读数）。 */
    await page.evaluate(() => {
      const B = { count: 0, secMark: performance.now(), driver: null, timer: 0 };
      window.__BENCH__ = B;
      const tick = () => {
        B.count++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      B.timer = setInterval(() => {
        const w = window.__CONSTELLA_E2E__;
        if (B.driver === 'move') {
          const { nodes, setNodes } = w.flow();
          const k = performance.now() / 33;
          setNodes(nodes.map((n, i) => (i % 5 === 0 ? { ...n, position: { x: n.position.x + Math.sin(k + i) * 2, y: n.position.y } } : n)));
        } else if (B.driver === 'pan') {
          // viewport 平移驱动（合成 wheel 经 ReactFlow onMove 拦截面；直改 viewport store 等价）
          const host = document.querySelector('.react-flow');
          if (host) {
            const k = performance.now() / 40;
            host.dispatchEvent(new WheelEvent('wheel', { deltaX: Math.sin(k) * 6, deltaY: 0, bubbles: true, cancelable: true }));
          }
        }
      }, 16);
      window.__BENCH_POP__ = () => {
        const now = performance.now();
        const elapsed = now - B.secMark;
        B.secMark = now;
        const frames = B.count;
        B.count = 0;
        return Math.round((frames / elapsed) * 1000);
      };
    });

    const sample = async (driver) => {
      await page.evaluate((d) => {
        const B = window.__BENCH__;
        B.driver = d;
        B.count = 0;
        B.secMark = performance.now();
      }, driver);
      const seconds = [];
      for (let i = 0; i < Math.ceil(SCENE_MS / 1000); i++) {
        await page.waitForTimeout(1000);
        seconds.push(await page.evaluate(() => window.__BENCH_POP__()));
      }
      await page.evaluate(() => {
        window.__BENCH__.driver = null;
      });
      return seconds;
    };

    const results = {};
    results['静态渲染'] = await sample(null);
    results['节点位移'] = await sample('move');
    results['viewport pan'] = await sample('pan');

    await page.evaluate(() => {
      clearInterval(window.__BENCH__.timer);
    });

    let worst = Infinity;
    let worstScene = '';
    console.log(`bench 负载：${NODES} 节点 / ${EDGES} 边（全自定义类型，MiniMap 常开）\n`);
    for (const [name, frames] of Object.entries(results)) {
      // 末秒含清理动作，取其余秒最差
      const full = frames.slice(0, -1);
      const min = Math.min(...full);
      if (min < worst) {
        worst = min;
        worstScene = name;
      }
      console.log(`${name}: 秒帧率=[${full.join(', ')}] 最差=${min}fps`);
    }
    console.log(`\n最差秒 fps = ${worst}（${worstScene}）——判据 ≥${FPS_FLOOR}（S-1 基线 51.9）`);

    // 结果留档（S-1 先例：results/bench-*.json）
    const resultsDir = path.join(repoRoot, 'client', 'results');
    mkdirSync(resultsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(
      path.join(resultsDir, `bench-${stamp}.json`),
      JSON.stringify({ nodes: NODES, edges: EDGES, sceneMs: SCENE_MS, scenes: results, worst, worstScene, floor: FPS_FLOOR, date: stamp }, null, 2),
    );

    if (worst < FPS_FLOOR) {
      console.error(`canvas-bench FAILED（最差 ${worst}fps < ${FPS_FLOOR}）`);
      process.exit(1);
    }
    console.log('canvas-bench ok');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('canvas-bench error:', err);
  process.exit(1);
});

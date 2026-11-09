#!/usr/bin/env node
// canvas-e2e.mjs —— 画布 E2E（T3-04 首建；C-01 §6.2 验收宿主；Playwright-core 驱动 Electron 产物）。
//
// 用法：node scripts/canvas-e2e.mjs（仓库根；任意 cwd 均可）
//   - 自动 pnpm -F ./client build（幂等，vite 增量）→ electron.launch（client 包产物）
//   - renderer 以 app://./index.html#e2e 装载 → window.__CONSTELLA_E2E__ 注入钩子激活
//   - 场景（首批 a/b，T3-06/T3-08 扩 d/e/f 全量）：
//       a) snap 开启拖动落点=20 倍数、关闭则否（§6.2a）
//       b) connect 三违例 toast 文案逐字（§6.2b；demo L1524/L1526/L1528）
//   - 真实输入经 Playwright mouse API（isTrusted）；S-1 ② view:window 约束仅在页内合成
//     dispatchEvent 路径生效，本脚本真实输入不受限。
//
// 退出码：全场景绿 exit 0；任一失败 exit 1（逐场景打印 [ok]/[fail]）。
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(repoRoot, 'client');
// playwright-core 是 client devDep（T0-05 锁版）——经 client 包上下文 resolve
const requireFromClient = createRequire(path.join(clientDir, 'package.json'));
const { _electron: electron } = requireFromClient('playwright-core');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '[ok]' : '[fail]'} ${name}${detail ? ` —— ${detail}` : ''}`);
}

/** E2E 注入文档：A/B 常规节点（单出单入）＋ T 触发节点（ins=[]）。 */
const DOC = {
  id: 'e2e-flow',
  name: 'e2e',
  nodes: [
    { id: 'a', type: 'llm.chat', name: 'A', position: { x: 80, y: 120 }, params: {} },
    { id: 'b', type: 'llm.chat', name: 'B', position: { x: 400, y: 120 }, params: {} },
    { id: 't', type: 'trigger.manual', name: 'T', position: { x: 720, y: 120 }, params: {} },
  ],
  edges: [],
};

async function main() {
  // 1) build（幂等）
  const build = spawnSync('pnpm', ['-F', './client', 'build'], { cwd: repoRoot, stdio: 'pipe', shell: true });
  if (build.status !== 0) {
    console.error(build.stdout?.toString());
    console.error(build.stderr?.toString());
    process.exit(1);
  }

  // 2) launch Electron（client 产物）
  const app = await electron.launch({ args: ['.'], cwd: clientDir });
  try {
    const page = await app.firstWindow();
    page.on('console', (msg) => {
      const t = msg.text();
      if (t.includes('e2e hook') || t.includes('error')) console.log(`[renderer] ${t}`);
    });

    // 3) 激活 e2e 钩子：设 hash 后 reload（产品会话零暴露面）
    await page.evaluate(() => {
      window.location.hash = '#e2e';
      window.location.reload();
    });
    await page.waitForFunction(() => Boolean(window.__CONSTELLA_E2E__), null, { timeout: 15000 });

    // 4) 装载 E2E 文档并等节点渲染
    await page.evaluate((doc) => window.__CONSTELLA_E2E__.loadFlow('e2e', doc), DOC);
    await page.waitForSelector('.cn-node[data-node-type="llm.chat"]', { timeout: 10000 });
    // 等布局稳定（xyflow 首帧测量）
    await page.waitForTimeout(400);

    const nodeBox = async (sel) => {
      const el = page.locator(sel).first();
      return el.boundingBox();
    };

    // ————— 场景 a：snap 开/关 拖动落点（§6.2a） —————
    {
      // a1: snap 开（默认）——拖 37px/13px，吸附后落点应为 20 倍数
      const box = await nodeBox('.cn-node[data-node-type="llm.chat"]');
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 37, cy + 13, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const posOn = await page.evaluate(() => {
        const n = window.__CONSTELLA_E2E__.flow().nodes.find((x) => x.id === 'a');
        return { x: n.position.x, y: n.position.y };
      });
      const onOk = posOn.x % 20 === 0 && posOn.y % 20 === 0;
      report('a1 snap 开：拖 37,13 → 落点 20 倍数', onOk, JSON.stringify(posOn));

      // a2: snap 关——拖 37px，落点应为非 20 倍数（自由位移）
      await page.evaluate(() => window.__CONSTELLA_E2E__.setSnap(false));
      const box2 = await nodeBox('.cn-node[data-node-type="llm.chat"]');
      const cx2 = box2.x + box2.width / 2;
      const cy2 = box2.y + box2.height / 2;
      await page.mouse.move(cx2, cy2);
      await page.mouse.down();
      await page.mouse.move(cx2 + 37, cy2 + 13, { steps: 5 });
      await page.mouse.up();
      await page.evaluate(() => window.__CONSTELLA_E2E__.setSnap(true)); // 复位
      await page.waitForTimeout(200);
      const posOff = await page.evaluate(() => {
        const n = window.__CONSTELLA_E2E__.flow().nodes.find((x) => x.id === 'a');
        return { x: n.position.x, y: n.position.y };
      });
      // 37px 位移在 20px 网格下不可能恰落倍数（前值是倍数）
      const offOk = posOff.x % 20 !== 0 || posOff.y % 20 !== 0;
      report('a2 snap 关：拖 37,13 → 落点非 20 倍数', offOk, JSON.stringify(posOff));
    }

    // ————— 场景 b：connect 三违例 toast 逐字（§6.2b） —————
    {
      const outHandle = page.locator('.cn-node[data-node-type="llm.chat"]').first().locator('.cn-port--out').first();
      const inHandle = page.locator('.cn-node[data-node-type="llm.chat"]').nth(1).locator('.cn-port--in').first();

      const dragTo = async (target) => {
        const from = await outHandle.boundingBox();
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        const to = await target();
        await page.mouse.move(to.x, to.y, { steps: 8 });
        await page.mouse.up();
        await page.waitForSelector('.cn-toast', { timeout: 5000 });
        const text = await page.locator('.cn-toast').last().textContent();
        await page.evaluate(() => {
          document.querySelectorAll('.cn-toast').forEach((el) => el.remove());
        });
        return text;
      };

      // b1: 自连（A out → A 中心）
      const selfBox = await nodeBox('.cn-node[data-node-type="llm.chat"]');
      const t1 = await dragTo(async () => ({ x: selfBox.x + selfBox.width / 2, y: selfBox.y + selfBox.height / 2 }));
      report('b1 自连 toast 逐字', t1 === '不能连接自己', `「${t1}」`);

      // b2: 触发节点无入口（A out → T 中心；loose 模式无 handle 也触发三查）
      const tBox = await nodeBox('.cn-node[data-node-type="trigger.manual"]');
      const t2 = await dragTo(async () => ({ x: tBox.x + tBox.width / 2, y: tBox.y + tBox.height / 2 }));
      report('b2 触发节点 toast 逐字', t2 === '「手动」是触发节点，没有输入口', `「${t2}」`);

      // b3: 重复边（先合法 A→B，再连一次同边）
      const inBox = await inHandle.boundingBox();
      await page.evaluate(() => {
        const w = window.__CONSTELLA_E2E__;
        const { edges, setEdges } = w.flow();
        setEdges([...edges, { id: 'e-seed', type: 'constella-edge', source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' }]);
      });
      const t3 = await dragTo(async () => ({ x: inBox.x + inBox.width / 2, y: inBox.y + inBox.height / 2 }));
      report('b3 重复边 toast 逐字', t3 === '这条连线已存在', `「${t3}」`);
      const edgeCount = await page.evaluate(() => window.__CONSTELLA_E2E__.flow().edges.length);
      report('b4 三违例零建边', edgeCount === 1, `edges=${edgeCount}`);
    }

    // ————— 场景 d/e：Delete 与快捷键（§6.2d/e；T3-06） —————
    {
      // d: 点击 B 选中 → Delete 删节点＋相邻边
      await page.evaluate(() => window.__CONSTELLA_E2E__.canvas().setSelection('b'));
      const before = await page.evaluate(() => window.__CONSTELLA_E2E__.flow().nodes.length);
      await page.keyboard.press('Delete');
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => ({
        nodes: window.__CONSTELLA_E2E__.flow().nodes.length,
        edges: window.__CONSTELLA_E2E__.flow().edges.length,
      }));
      report('d1 Delete 删选中节点', after.nodes === before - 1, JSON.stringify(after));
      report('d2 相邻边同删', after.edges === 0, `edges=${after.edges}`);

      // e1: Ctrl+Z 回退删除 → Ctrl+Y 重做
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(150);
      const undone = await page.evaluate(() => window.__CONSTELLA_E2E__.flow().nodes.length);
      report('e1 Ctrl+Z 撤销删除', undone === before, `nodes=${undone}`);
      await page.keyboard.press('Control+y');
      await page.waitForTimeout(150);
      const redone = await page.evaluate(() => window.__CONSTELLA_E2E__.flow().nodes.length);
      report('e2 Ctrl+Y 重做', redone === before - 1, `nodes=${redone}`);

      // e3: 焦点守卫——input 聚焦时 Ctrl+Z 不触发 undo
      await page.keyboard.press('Control+z'); // 先回退到 3 节点
      await page.waitForTimeout(150);
      const base = await page.evaluate(() => window.__CONSTELLA_E2E__.flow().nodes.length);
      await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'e2e-guard-input';
        document.body.appendChild(input);
        input.focus();
      });
      await page.keyboard.press('Control+z'); // input 聚焦 → 应无操作
      await page.waitForTimeout(150);
      const guarded = await page.evaluate(() => {
        document.getElementById('e2e-guard-input')?.remove();
        return window.__CONSTELLA_E2E__.flow().nodes.length;
      });
      report('e3 焦点守卫（input 聚焦 Ctrl+Z 不撤销）', guarded === base, `nodes=${guarded}`);
    }

    // ————— 场景 c：双击开抽屉（§6.2c；T3-08） —————
    {
      // c1: 双击节点 → edit 抽屉
      const nb = await nodeBox('.cn-node[data-node-type="llm.chat"]');
      await page.mouse.dblclick(nb.x + nb.width / 2, nb.y + nb.height / 2);
      await page.waitForTimeout(250);
      const editMode = await page.evaluate(() => {
        const d = document.querySelector('.cn-drawer');
        return { open: d?.classList.contains('cn-drawer--open') ?? false, mode: d?.getAttribute('data-drawer-mode') ?? '' };
      });
      report('c1 双击节点开 edit 抽屉', editMode.open && editMode.mode === 'edit', JSON.stringify(editMode));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);

      // c2: 双击空白 → create 抽屉（类型网格可见）
      await page.mouse.dblclick(60, 600);
      await page.waitForTimeout(250);
      const createMode = await page.evaluate(() => {
        const d = document.querySelector('.cn-drawer');
        const grid = document.querySelectorAll('.cn-drawer__type').length;
        return { open: d?.classList.contains('cn-drawer--open') ?? false, mode: d?.getAttribute('data-drawer-mode') ?? '', grid };
      });
      report('c2 双击空白开 create 抽屉＋类型网格', createMode.open && createMode.mode === 'create' && createMode.grid > 0, JSON.stringify(createMode));

      // c3: 网格点类型 → 节点落图（缺省 onCreate=drawer 落点）
      const nodesBefore = await page.evaluate(() => window.__CONSTELLA_E2E__.flow().nodes.length);
      await page.locator('.cn-drawer__type[data-node-type="llm.chat"]').first().click();
      await page.waitForTimeout(250);
      const nodesAfter = await page.evaluate(() => window.__CONSTELLA_E2E__.flow().nodes.length);
      report('c3 类型网格点选落图', nodesAfter === nodesBefore + 1, `${nodesBefore}→${nodesAfter}`);
    }

    // ————— §6.6 undo/redo 产品壳集成回归（T3-08 收尾；S-1 判据 2 同口径） —————
    {
      const result = await page.evaluate(async () => {
        const w = window.__CONSTELLA_E2E__;
        // 重置到干净基线
        w.loadFlow('undo-bench', { name: 'undo', nodes: [], edges: [] });
        const flow = w.flow;
        const snap = () => JSON.stringify(flow().nodes.map((n) => [n.id, n.position.x, n.position.y]));
        const S = [snap()]; // S[0]=初始
        // 100 离散操作：每次落一个节点（addNodes 单历史项）
        for (let i = 0; i < 100; i++) {
          flow().addNodes([
            { id: `u${i}`, type: 'constella-node', position: { x: (i % 20) * 40, y: Math.floor(i / 20) * 60 }, data: { nodeId: `u${i}`, type: 'llm.chat', params: {} } },
          ]);
          S.push(snap());
        }
        // undo ×100：第 k 次后应=S[100-k]；栈深 60 → 可回退至 S[40]，k>60 恒 S[40]（稳定 no-op）
        let undoOk = 0;
        const stackLimit = Math.min(60, 100); // 产品 HISTORY_LIMIT=60（C-01 §4）
        for (let k = 1; k <= 100; k++) {
          flow().undo();
          const expectIdx = Math.max(100 - stackLimit, 100 - k);
          if (snap() === S[expectIdx]) undoOk++;
        }
        // redo ×100：undo 终态=S[40]，第 k 次后应=S[40+k]（redo 栈上限=undo 实际步数）
        let redoOk = 0;
        for (let k = 1; k <= 100; k++) {
          flow().redo();
          const expectIdx = Math.min(100, 100 - stackLimit + k);
          if (snap() === S[expectIdx]) redoOk++;
        }
        return { undoOk, redoOk, finalMatch: snap() === S[100], stackDepth: w.temporal().pastStates.length };
      });
      report('§6.6 undo 100/100 快照比对', result.undoOk === 100, `ok=${result.undoOk}`);
      report('§6.6 redo 100/100 快照比对', result.redoOk === 100, `ok=${result.redoOk}`);
      report('§6.6 终态=S100＋栈深≤60', result.finalMatch && result.stackDepth <= 60, JSON.stringify(result));
    }
  } finally {
    await app.close();
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`canvas-e2e FAILED（${failed.length}/${results.length} 场景失败）`);
    process.exit(1);
  }
  console.log(`canvas-e2e ok（${results.length} 场景全绿）`);
}

main().catch((err) => {
  console.error('canvas-e2e error:', err);
  process.exit(1);
});

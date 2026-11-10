// C-12 SkyFrameLoop（TDD-C-12 §3）：frame 主循环按层合成（demo L4492-4724，1:1 移植）。
// 主循环（demo L4494 注释原文）：天球摆动(rot/dx/dy) + 鼠标视差(px/py) → 按层合成：
// 银河 → M31 大小盘 → 气晖/星云/气体 → 迷你星系 → 银道微星/星团/星场/亮星 → 流星卫星；
// PAUSED 时整帧跳过（demo L4500——rAF 调度保留、回调内零绘制，省电）。
// 另收 spikeLine（demo L4474-4490，位于流星段行区间但唯一调用方=亮星渲染，对照表登记于此）。
// 结构差：模块级 last/PAUSED 挂 SkyState；rAF id 追踪（s.rafId）以支持卸载 cancelAnimationFrame（03 §1）。
import type { SkyState } from './sky-canvas';
import { TAU, BAND_ANGLE, PALETTE, rand, blob, gasSprite } from './utils';
import { dustAt } from './noise-field';
import { drawM31 } from './m31-prerender';
import { spawnMeteor, spawnSat } from './meteors-satellites';

function spikeLine(s: SkyState, x: number, y: number, ang: number, len: number, r: number, col: string, a: number): void {   // demo L4474-4490
  const ctx = s.ctx;
  const ux = Math.cos(ang), uy = Math.sin(ang);
  for (const dir of [1, -1]) {
    const ex = x + ux * len * dir, ey = y + uy * len * dir;
    const gr = ctx.createLinearGradient(x, y, ex, ey);
    gr.addColorStop(0, 'rgba(255,255,255,' + .85 * a + ')');
    gr.addColorStop(.25, 'rgba(' + col + ',' + .4 * a + ')');
    gr.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.strokeStyle = gr;
    ctx.lineWidth = Math.max(.8, r * .45);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
}

// frame 主循环（demo L4495-4724）
export function frame(s: SkyState, now: number): void {
  s.rafId = s.win.requestAnimationFrame((t) => frame(s, t));         // demo L4496（+rafId 追踪：卸载取消）
  const ctx = s.ctx;
  const t = now / 1000;
  const dt = Math.min(.05, (now - s.last) / 1000);
  s.last = now;
  if (s.PAUSED) return;                                              // demo L4500（PAUSED 整帧跳过）

  s.px += (s.tx - s.px) * .04;
  s.py += (s.ty - s.py) * .04;

  const rot = s.REDUCED ? 0 : Math.sin(t * .02) * .022;
  const dx = s.REDUCED ? 0 : Math.sin(t * .013) * 26;
  const dy = s.REDUCED ? 0 : Math.cos(t * .009) * 14;
  ctx.save();
  ctx.translate(s.W / 2 + dx + s.px * 7, s.H / 2 + dy + s.py * 7);
  ctx.rotate(rot);
  ctx.drawImage(s.sky, -s.skyW / 2, -s.skyH / 2, s.skyW, s.skyH);
  ctx.restore();

  const spinOn = s.REDUCED ? 0 : 1;
  const TILT_BIG = -32 * Math.PI / 180, TILT_SMALL = 70 * Math.PI / 180;
  if (s.LAYER.disk) drawM31(s, s.diskBig,
          s.W * .72 + dx * .9 + Math.sin(t * .011) * 9 * spinOn + s.px * 4,
          s.H * .70 + dy * .9 + Math.cos(t * .008) * 6 * spinOn + s.py * 4,
          t * TAU / 260 * spinOn, TILT_BIG);
  if (s.LAYER.disk) drawM31(s, s.diskSmall,
          s.W * .15 + dx * .9 + Math.sin(t * .013) * 7 * spinOn + s.px * 3,
          s.H * .15 + dy * .9 + Math.cos(t * .01) * 5 * spinOn + s.py * 3,
          t * TAU / 260 * spinOn + 2.1, TILT_SMALL);

  ctx.globalCompositeOperation = 'lighter';

  const LW = Math.max(2, Math.round(s.W / 6)), LH = Math.max(2, Math.round(s.H / 6));
  if (s.airGlow.width !== LW || s.airGlow.height !== LH) { s.airGlow.width = LW; s.airGlow.height = LH; }
  else s.airCtx.clearRect(0, 0, LW, LH);
  s.airCtx.globalCompositeOperation = 'lighter';
  const af = LW / s.W;
  if (s.LAYER.pulse) for (const p of s.pulses) {
    const a = (.02 + .02 * (0.5 + 0.5 * Math.sin(t * p.sp * TAU + p.ph))) * (s.REDUCED ? .4 : 1);
    const r = Math.min(s.W, s.H) * p.rf * af;
    const x = p.fx * LW + s.px * 4 * af, y = p.fy * LH + s.py * 4 * af;
    const gr = s.airCtx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(' + p.col + ',' + a + ')');
    gr.addColorStop(1, 'rgba(' + p.col + ',0)');
    s.airCtx.fillStyle = gr;
    s.airCtx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.drawImage(s.airGlow, 0, 0, s.W, s.H);

  const cAng = BAND_ANGLE + rot, cCos = Math.cos(cAng), cSin = Math.sin(cAng);

  const gB = s.REDUCED ? .1 : 1;

  if (s.LAYER.mega) for (const p of s.mega) {
    const gx = p.sx + p.ox * Math.sin(t * p.w1 + p.p1) + s.px * 5;
    const gy = p.sy + p.oy * Math.cos(t * p.w2 + p.p2) + s.py * 5;
    const a = p.a * (1 - p.bA * gB + p.bA * gB * Math.sin(t * p.bW + p.bP));
    if (a < .01) continue;
    const r = p.r * (1 + .1 * Math.sin(t * p.bW * .7 + p.bP));
    ctx.globalAlpha = a;
    ctx.drawImage(gasSprite(s, p.col), gx - r, gy - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;

  if (s.LAYER.gas) for (const p of s.gas) {
    const u = p.bx + p.ox * Math.sin(t * p.w1 + p.p1);
    const v = p.by + p.oy * Math.cos(t * p.w2 + p.p2);
    const dk = dustAt(s, u, v);
    if (dk > .93) continue;
    const a = p.a * (1 - p.bA * gB + p.bA * gB * Math.sin(t * p.bW + p.bP)) * (1 - .92 * dk);
    if (a < .012) continue;
    const gx = s.W / 2 + dx + s.px * 7 + (u * cCos - v * cSin);
    const gy = s.H / 2 + dy + s.py * 7 + (u * cSin + v * cCos);
    const r = p.r * (1 + .12 * Math.sin(t * p.bW * .7 + p.bP));
    ctx.globalAlpha = a;
    ctx.drawImage(gasSprite(s, p.col), gx - r, gy - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;

  if (s.LAYER.minis) for (const m of s.minis) {
    const mx = m.cx + s.px * 9;
    const my = m.cy + s.py * 9;
    const al = m.al * (1 - m.bA * gB + m.bA * gB * (.5 + .5 * Math.sin(t * m.bW + m.bP)));
    if (al < .008) continue;
    const sc = m.sc * (1 + m.sB * Math.sin(t * m.sW + m.sP));
    const s2 = 128 * sc;
    ctx.globalAlpha = al;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(m.tilt);
    ctx.scale(1, m.sq);
    ctx.rotate(m.r0 + t * m.rw * spinOn);
    ctx.drawImage(m.sp, -s2 / 2, -s2 / 2, s2, s2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  const twB = s.REDUCED ? .1 : .3;
  if (s.LAYER.band) for (const st of s.bandStars) {
    if (st.occ < .12) continue;
    const twv = Math.sin(t * st.tw + st.ph);
    let a = st.base * ((1 - twB) + twB * twv) * st.occ;
    if (st.glint && twv > .88) a = Math.min(1, a + (twv - .88) * 5);
    if (a < .03) continue;
    const bx = s.W / 2 + dx + s.px * 7 + (st.u * cCos - st.v * cSin);
    const by = s.H / 2 + dy + s.py * 7 + (st.u * cSin + st.v * cCos);
    ctx.globalAlpha = a;
    ctx.fillStyle = PALETTE[st.pi]?.rgb ?? '';
    ctx.fillRect(bx, by, st.sz, st.sz);
  }
  ctx.globalAlpha = 1;

  const twC = s.REDUCED ? .1 : .3;
  if (s.LAYER.clusters) for (const cl of s.clusters) {
    const pl = 7 + cl.par * 4;
    const cx = s.W / 2 + dx + s.px * pl + (cl.x * cCos - cl.y * cSin);
    const cy = s.H / 2 + dy + s.py * pl + (cl.x * cSin + cl.y * cCos);
    const breathe = .07 + .03 * Math.sin(t * cl.hb * TAU + cl.hph);
    blob(ctx, cx, cy, cl.haloR, '160,200,255', breathe * cl.occ);
    for (const m of cl.members) {
      const twv = Math.sin(t * m.tw + m.ph);
      let a = m.base * ((1 - twC) + twC * twv) * cl.occ;
      if (m.glint && twv > .88) a = Math.min(1, a + (twv - .88) * 5);
      if (a < .03) continue;
      const mx = cx + m.dx, my = cy + m.dy;
      ctx.globalAlpha = a;
      if (m.sz) {
        ctx.fillStyle = PALETTE[m.pi]?.rgb ?? '';
        ctx.fillRect(mx, my, m.sz, m.sz);
      } else {
        ctx.drawImage(s.sprites[m.pi]!, mx - m.ssz / 2, my - m.ssz / 2, m.ssz, m.ssz);
      }
    }
  }
  ctx.globalAlpha = 1;

  const twAmp = s.REDUCED ? .12 : .38;
  if (s.LAYER.stars) for (const st of s.stars) {
    const twv = Math.sin(t * st.tw + st.ph);
    let a = st.base * ((1 - twAmp) + twAmp * twv);
    if (st.glint && twv > .86) a = Math.min(1, a + (twv - .86) * 4);
    const x = st.x + s.px * st.par * 14, y = st.y + s.py * st.par * 14;
    ctx.globalAlpha = a;
    if (st.r < .9) {
      ctx.fillStyle = PALETTE[st.pi]?.rgb ?? '';
      ctx.fillRect(x, y, 1.4, 1.4);
    } else {
      const sz = st.r * 10;
      ctx.drawImage(s.sprites[st.pi]!, x - sz / 2, y - sz / 2, sz, sz);
      if (st.r > 2.1) {
        ctx.fillStyle = 'rgba(255,255,255,1)';
        ctx.beginPath(); ctx.arc(x, y, st.r * .55, 0, TAU); ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;

  if (s.LAYER.heroes) for (const h of s.heroes) {
    const twv = .8 + .2 * Math.sin(t * h.tw + h.ph);
    const x = h.x + s.px * h.par * 18, y = h.y + s.py * h.par * 18;
    const r = h.r * twv;
    const halo = r * 13;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, halo);
    gr.addColorStop(0, 'rgba(' + h.col + ',' + .3 * twv + ')');
    gr.addColorStop(.22, 'rgba(' + h.col + ',' + .085 * twv + ')');
    gr.addColorStop(1, 'rgba(' + h.col + ',0)');
    ctx.fillStyle = gr;
    ctx.fillRect(x - halo, y - halo, halo * 2, halo * 2);

    spikeLine(s, x, y, 0, h.spike * twv, r, h.col, twv * .55);
    spikeLine(s, x, y, Math.PI / 2, h.spike * twv, r, h.col, twv * .55);
    if (h.diag) {
      spikeLine(s, x, y, Math.PI / 4, h.spike * twv * .45, r, h.col, twv * .28);
      spikeLine(s, x, y, -Math.PI / 4, h.spike * twv * .45, r, h.col, twv * .28);
    }
    if (h.streak) {
      const sl = r * 30 * twv;
      const sg = ctx.createLinearGradient(x - sl, y, x + sl, y);
      sg.addColorStop(0, 'rgba(120,200,255,0)');
      sg.addColorStop(.5, 'rgba(160,220,255,' + .22 * twv + ')');
      sg.addColorStop(1, 'rgba(120,200,255,0)');
      ctx.strokeStyle = sg;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - sl, y);
      ctx.lineTo(x + sl, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,' + .8 * twv + ')';
    ctx.beginPath(); ctx.arc(x, y, r * .8, 0, TAU); ctx.fill();
  }

  if (!s.REDUCED) {                                                  // demo L4687-4694
    if (s.LAYER.meteor && t > s.nextMeteor) {
      spawnMeteor(s);
      if (Math.random() < .22) spawnMeteor(s);
      s.nextMeteor = t + rand(2.2, 8);
    }
    if (s.LAYER.sat && t > s.nextSat) { spawnSat(s); s.nextSat = t + rand(26, 70); }
  }
  for (let i = s.meteors.length - 1; i >= 0; i--) {
    const m = s.meteors[i]!;
    m.t += dt;
    m.x += m.vx * dt; m.y += m.vy * dt;
    if (m.t >= m.life || m.x < -400 || m.x > s.W + 400 || m.y < -400 || m.y > s.H + 400) {
      s.meteors.splice(i, 1); continue;
    }
    if (m.sat) {
      ctx.globalAlpha = .8;
      ctx.drawImage(s.sprites[3]!, m.x - 5, m.y - 5, 10, 10);
      continue;
    }
    const pr = m.t / m.life;
    const env = Math.sin(Math.PI * Math.min(1, pr));
    const tail = m.len! * (.5 + .5 * env);
    const tx2 = m.x - m.dx! * tail, ty2 = m.y - m.dy! * tail;
    const gr = ctx.createLinearGradient(m.x, m.y, tx2, ty2);
    gr.addColorStop(0, 'rgba(255,255,255,' + env + ')');
    gr.addColorStop(.15, 'rgba(170,225,255,' + .6 * env + ')');
    gr.addColorStop(1, 'rgba(120,190,255,0)');
    ctx.strokeStyle = gr;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx2, ty2); ctx.stroke();
    ctx.globalAlpha = env;
    ctx.drawImage(s.sprites[2]!, m.x - 9, m.y - 9, 18, 18);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export interface SkyFrameLoop {
  start(): void;                                                     // demo L4759（requestAnimationFrame(frame)）
  stop(): void;                                                      // 卸载=cancelAnimationFrame（03 §1）
}

export function createFrameLoop(s: SkyState, win: Window): SkyFrameLoop {
  let running = false;                                               // 重入守卫：防消费方双 start 造成双 rAF 链
  return {
    start() { if (running) return; running = true; s.rafId = win.requestAnimationFrame((t) => frame(s, t)); },
    stop() { running = false; win.cancelAnimationFrame(s.rafId); },
  };
}

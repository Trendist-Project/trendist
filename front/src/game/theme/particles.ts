import type { Float, RGBA } from './look';
import { rgba } from './look';

/**
 * 화면 위에 떠다니는 입자(떨어지는 꽃잎·낙엽·눈, 비, 안개, 번개 …, 4.38). 입자를 저장하지 않는다:
 * 번호마다 시드로 처음 자리·속도를 정하고, 그릴 때 시간 t(초)만으로 위치를 계산한다(할당 없음, 어느 화면 크기에서나 같은 식).
 * still이면 시간을 0으로 고정한다(prefers-reduced-motion).
 */
const rnd = (i: number, s: number) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const wrap = (v: number, m: number) => ((v % m) + m) % m;
const count = (w: number, h: number, per: number, max: number) => Math.min(max, Math.max(8, Math.round((w * h) / per)));

type Ctx = CanvasRenderingContext2D;

/** 부드러운 빛 점 스프라이트(눈송이·반딧불 …): 그릴 때마다 그라데이션을 만들지 않고 한 번 만들어 둔 그림을 늘려 쓴다 */
const sprites = new Map<string, HTMLCanvasElement>();
function soft(rgb: string, core = 0.35): HTMLCanvasElement {
  let c = sprites.get(rgb + core);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 48;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(core, `rgba(${rgb},0.75)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 48, 48); sprites.set(rgb + core, c); return c;
}

/** 눈: 멀리(작고 느림) · 중간 · 가까이(크고 흐리고 빠름) 세 겹이라 깊이가 느껴진다 */
function snow(ctx: Ctx, w: number, h: number, t: number, n: number, alpha: number) {
  const dot = soft('255,255,255', 0.45);
  for (let i = 0; i < n; i++) {
    const layer = i % 3, sz = [1.6, 2.8, 6.5][layer] * (0.7 + rnd(i, 4) * 0.7), sp = [22, 40, 78][layer] * (0.7 + rnd(i, 3) * 0.6), sway = [6, 14, 30][layer];
    const x = wrap(rnd(i, 1) * w + Math.sin(t * (0.5 + layer * 0.25) + i) * sway, w), y = wrap(rnd(i, 2) * h + t * sp, h);
    ctx.globalAlpha = alpha * [0.55, 0.8, 0.42][layer]; ctx.drawImage(dot, x - sz, y - sz, sz * 2, sz * 2);
  }
  ctx.globalAlpha = 1;
}

/** 비: 두 겹의 빗줄기와 땅에 튀는 물방울 */
function rain(ctx: Ctx, w: number, h: number, t: number, n: number, slant: number, alpha: number) {
  for (let layer = 0; layer < 2; layer++) {
    ctx.strokeStyle = `rgba(206,222,255,${alpha * (layer ? 1 : 0.55)})`; ctx.lineWidth = layer ? 1.5 : 1; ctx.beginPath();
    for (let i = layer; i < n; i += 2) {
      const len = (layer ? 18 : 10) + rnd(i, 4) * (layer ? 18 : 8), sp = (layer ? 900 : 620) + rnd(i, 3) * 360;
      const y = wrap(rnd(i, 2) * (h + 60) + t * sp, h + 60) - 30, x = wrap(rnd(i, 1) * (w + 80) - y * slant, w + 80) - 40;
      ctx.moveTo(x, y); ctx.lineTo(x - len * slant, y + len);
    }
    ctx.stroke();
  }
  ctx.lineWidth = 1; // 물방울 파문: 짧게 퍼졌다 사라진다
  for (let i = 0; i < Math.floor(n / 5); i++) {
    const ph = wrap(t * 1.6 + rnd(i, 7), 1), slot = Math.floor(t * 1.6 + rnd(i, 7)), x = rnd(i + slot * 31, 8) * w, y = rnd(i + slot * 17, 9) * h;
    ctx.strokeStyle = `rgba(206,226,255,${0.32 * (1 - ph)})`; ctx.beginPath(); ctx.ellipse(x, y, 2 + ph * 11, (2 + ph * 11) * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
  }
}

/** 꽃잎·낙엽: 뒤집히며(가로 폭이 오가며) 흔들려 떨어진다. kind에 따라 모양과 색이 다르다 */
function flutter(ctx: Ctx, w: number, h: number, t: number, n: number, colors: string[], sizeMul: number, speed: number, leaf: boolean) {
  for (let i = 0; i < n; i++) {
    const near = rnd(i, 9) > 0.7, sz = (4 + rnd(i, 4) * 5) * sizeMul * (near ? 1.7 : 1), sway = 30 + rnd(i, 5) * 50, ph = rnd(i, 6) * 6.28;
    const x = wrap(rnd(i, 1) * w + Math.sin(t * 0.7 + ph) * sway + t * 12, w), y = wrap(rnd(i, 2) * h + t * (speed + rnd(i, 3) * speed) * (near ? 1.4 : 1), h);
    const flip = Math.cos(t * (1.3 + rnd(i, 7)) + ph);
    ctx.save(); ctx.translate(x, y); ctx.rotate(t * (0.4 + rnd(i, 7) * 0.6) + ph); ctx.scale(1, 0.25 + 0.75 * Math.abs(flip));
    ctx.globalAlpha = near ? 0.78 : 0.95; ctx.fillStyle = colors[Math.floor(rnd(i, 8) * colors.length)];
    ctx.beginPath();
    if (leaf) { ctx.moveTo(0, -sz); ctx.quadraticCurveTo(sz * 0.9, -sz * 0.1, 0, sz); ctx.quadraticCurveTo(-sz * 0.9, -sz * 0.1, 0, -sz); }
    else { ctx.moveTo(0, -sz * 0.8); ctx.bezierCurveTo(sz * 0.9, -sz * 0.9, sz * 0.9, sz * 0.5, 0, sz * 0.8); ctx.bezierCurveTo(-sz * 0.9, sz * 0.5, -sz * 0.9, -sz * 0.9, 0, -sz * 0.8); }
    ctx.fill();
    ctx.strokeStyle = leaf ? 'rgba(60,20,0,0.4)' : 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0, -sz * 0.8); ctx.lineTo(0, sz * 0.8); ctx.stroke();
    ctx.restore();
  }
}

function bubbles(ctx: Ctx, w: number, h: number, t: number, n: number) {
  ctx.lineWidth = 1.2;
  for (let i = 0; i < n; i++) {
    const r = 2 + rnd(i, 4) * 6;
    const x = wrap(rnd(i, 1) * w + Math.sin(t * 0.9 + i) * 14, w), y = h - wrap(rnd(i, 2) * h + t * (20 + rnd(i, 3) * 40), h);
    ctx.strokeStyle = 'rgba(200,240,255,0.5)'; ctx.fillStyle = 'rgba(200,240,255,0.1)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

/** 몇 초마다 한 번 대각선으로 지나가는 별똥별 */
function meteors(ctx: Ctx, w: number, h: number, t: number) {
  const cycle = 3.2, k = Math.floor(t / cycle), p = (t % cycle) / 0.9;
  if (p >= 1) return;
  const x0 = rnd(k, 1) * w * 0.9 + w * 0.1, y0 = rnd(k, 2) * h * 0.35, len = Math.min(w, h) * 0.35, x = x0 - len * p, y = y0 + len * 0.55 * p;
  const g = ctx.createLinearGradient(x, y, x + len * 0.3, y - len * 0.165);
  g.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - p)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len * 0.3, y - len * 0.165); ctx.stroke();
}

const PETAL = ['rgba(255,196,214,0.85)', 'rgba(255,214,226,0.85)', 'rgba(255,176,200,0.8)'];
const LEAF = ['rgba(222,112,36,0.88)', 'rgba(196,64,32,0.88)', 'rgba(232,170,44,0.88)', 'rgba(160,96,32,0.88)'];

export function drawFloat(ctx: Ctx, kind: Float, w: number, h: number, now: number, still: boolean) {
  if (kind === 'none') return;
  const t = still ? 0 : now / 1000;
  ctx.save();
  switch (kind) {
    case 'snow': snow(ctx, w, h, t, count(w, h, 11000, 110), 0.9); break;
    case 'petals': flutter(ctx, w, h, t, count(w, h, 26000, 44), PETAL, 1, 22, false); break;
    case 'leaves': flutter(ctx, w, h, t, count(w, h, 30000, 36), LEAF, 1.25, 30, true); break;
    case 'bubbles': bubbles(ctx, w, h, t, count(w, h, 24000, 40)); break;
    case 'meteors': if (!still) meteors(ctx, w, h, t); break;
  }
  ctx.restore();
}

// ------------------------------------------------------------------ 날씨

/** 0 맑음 1 구름 2 비 3 눈 4 안개 5 뇌우 */
export const WEATHER_NAMES = ['맑음', '구름', '비', '눈', '안개', '뇌우'];

const TINT: Record<number, RGBA> = {
  1: [40, 50, 70, 0.12], 2: [30, 45, 75, 0.2], 3: [225, 235, 250, 0.1], 4: [210, 218, 226, 0.28], 5: [20, 28, 50, 0.3],
};
export const weatherTint = (weather: number): RGBA | null => TINT[weather] ?? null;

function blobs(ctx: Ctx, w: number, h: number, t: number, n: number, rgb: string, alpha: number, speed: number) {
  const R = Math.max(w, h) * 0.45;
  for (let i = 0; i < n; i++) {
    const x = wrap(rnd(i, 1) * (w + R * 2) + t * speed * (0.6 + rnd(i, 3)), w + R * 2) - R, y = rnd(i, 2) * h;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R * (0.6 + rnd(i, 4) * 0.5));
    g.addColorStop(0, `rgba(${rgb},${alpha})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - R * 1.2, y - R * 1.2, R * 2.4, R * 2.4);
  }
}

/** 번개: 9초 안의 정해진 순간에 두 번 번쩍이고, 가끔 갈라진 번개 줄기가 보인다 */
function lightning(ctx: Ctx, w: number, h: number, t: number) {
  const cycle = 9, k = Math.floor(t / cycle), at = 2 + rnd(k, 1) * 5, dt = t - k * cycle - at;
  if (dt < 0 || dt > 0.6) return;
  const a = dt < 0.1 ? 1 - dt / 0.1 : dt < 0.2 ? 0 : dt < 0.3 ? 0.7 : Math.max(0, 0.7 * (1 - (dt - 0.3) / 0.3));
  ctx.fillStyle = `rgba(230,238,255,${0.5 * a})`; ctx.fillRect(0, 0, w, h);
  if (dt < 0.2) {
    let x = w * (0.15 + rnd(k, 2) * 0.7), y = 0; ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, y);
    for (let i = 0; i < 9; i++) { x += (rnd(k * 9 + i, 3) - 0.5) * 70; y += h * 0.55 / 9; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

export function drawWeather(ctx: Ctx, weather: number, w: number, h: number, now: number, still: boolean) {
  if (weather <= 0) return;
  const t = still ? 0 : now / 1000;
  ctx.save();
  if (weather === 1) blobs(ctx, w, h, t, 5, '20,28,44', 0.14, 14);
  else if (weather === 2) rain(ctx, w, h, t, count(w, h, 3600, 300), 0.12, 0.5);
  else if (weather === 3) snow(ctx, w, h, t, count(w, h, 5200, 240), 0.95);
  else if (weather === 4) blobs(ctx, w, h, t, 7, '232,236,240', 0.2, 10);
  else if (weather === 5) { rain(ctx, w, h, t, count(w, h, 2400, 480), 0.3, 0.55); if (!still) lightning(ctx, w, h, t); }
  ctx.restore();
}

export { rgba };

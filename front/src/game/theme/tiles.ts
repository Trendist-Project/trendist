/**
 * 아레나 바닥 텍스처(4.38): 코드로 한 번 만들어 캐시하는 이음매 없는 타일(512×512). 바닥 색은 팔레트가 정하고,
 * 이 타일은 "질감과 디테일"만 흰색·검은색·포인트 색의 반투명 층으로 담아 어떤 시간대 색 위에서도 어울린다.
 * 시드를 고정해 누구에게나 같은 모양이고, 가장자리를 넘는 요소는 반대편에도 그려 타일을 이어 붙여도 티가 나지 않는다.
 */
export type Tile = 'meadow' | 'blossom' | 'leaf' | 'snow' | 'pool' | 'ocean' | 'neon' | 'space' | 'caustic' | 'stars'
  | 'px_meadow' | 'px_forest' | 'px_desert' | 'px_snow' | 'px_dungeon'
  | 'sand' | 'stone' | 'crowd' | 'crowd2' | 'volcanic' | 'lavacracks' | 'lavaflow';
/** 도트(픽셀) 질감 종류: 선명한 모서리를 유지해야 하므로 그릴 때 보간하지 않는다 */
export const PIXEL_TILES: ReadonlySet<Tile> = new Set<Tile>(['px_meadow', 'px_forest', 'px_desert', 'px_snow', 'px_dungeon']);
export const TILE = 512;

type Ctx = CanvasRenderingContext2D;
const cache = new Map<Tile, HTMLCanvasElement>();

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** (x, y)에 반지름 r쯤 되는 그림을 그린다. 타일 가장자리를 넘으면 반대편에도 그려 이음매를 없앤다 */
function put(ctx: Ctx, x: number, y: number, r: number, draw: () => void) {
  for (const ox of [0, -TILE, TILE]) for (const oy of [0, -TILE, TILE]) {
    if (x + ox + r < 0 || x + ox - r > TILE || y + oy + r < 0 || y + oy - r > TILE) continue;
    ctx.save(); ctx.translate(ox, oy); draw(); ctx.restore();
  }
}

// ---- 주기 값 잡음(타일 가장자리에서 이어진다)
function makeNoise(n: number, rnd: () => number) { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rnd(); return { n, g }; }
function sample(nz: { n: number; g: Float32Array }, u: number, v: number) {
  const { n, g } = nz, x = u * n, y = v * n, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), w = (i: number) => ((i % n) + n) % n;
  const a = g[w(y0) * n + w(x0)], b = g[w(y0) * n + w(x0 + 1)], c = g[w(y0 + 1) * n + w(x0)], d = g[w(y0 + 1) * n + w(x0 + 1)];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(nzs: { n: number; g: Float32Array }[], u: number, v: number) {
  let s = 0, amp = 1, tot = 0;
  for (const nz of nzs) { s += sample(nz, u, v) * amp; tot += amp; amp *= 0.5; }
  return s / tot;
}
/** 잡음으로 흰/검은 반투명 층을 칠한다(빛 받는 곳·그늘). light·dark는 최대 투명도 */
function shade(ctx: Ctx, rnd: () => number, cells: number[], light: number, dark: number, tint: [number, number, number] = [0, 0, 0], lightTint: [number, number, number] = [255, 255, 255]) {
  const nzs = cells.map((c) => makeNoise(c, rnd)), img = ctx.createImageData(TILE, TILE), d = img.data;
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const v = fbm(nzs, x / TILE, y / TILE), k = (v - 0.5) * 2, i = (y * TILE + x) * 4;
    if (k > 0) { d[i] = lightTint[0]; d[i + 1] = lightTint[1]; d[i + 2] = lightTint[2]; d[i + 3] = Math.min(255, k * light * 255 * 1.6); }
    else { d[i] = tint[0]; d[i + 1] = tint[1]; d[i + 2] = tint[2]; d[i + 3] = Math.min(255, -k * dark * 255 * 1.6); }
  }
  const tmp = document.createElement('canvas'); tmp.width = tmp.height = TILE; tmp.getContext('2d')!.putImageData(img, 0, 0);
  ctx.drawImage(tmp, 0, 0);
}

function blade(ctx: Ctx, rnd: () => number, x: number, y: number, len: number, color: string, w: number) {
  const a = -Math.PI / 2 + (rnd() - 0.5) * 1.0, bend = (rnd() - 0.5) * len * 0.5;
  put(ctx, x, y, len, () => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + bend, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  });
}

function flower(ctx: Ctx, rnd: () => number, x: number, y: number, petals: string[], size: number) {
  const col = petals[Math.floor(rnd() * petals.length)], rot = rnd() * 6.28;
  put(ctx, x, y, size * 3, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(x + size * 0.5, y + size * 0.7, size * 2, size * 1.3, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = col;
    for (let i = 0; i < 5; i++) { const a = rot + (i / 5) * 6.283; ctx.beginPath(); ctx.arc(x + Math.cos(a) * size * 1.15, y + Math.sin(a) * size * 1.15, size * 0.95, 0, 6.3); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,205,60,0.95)'; ctx.beginPath(); ctx.arc(x, y, size * 0.62, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(x - size * 0.25, y - size * 0.25, size * 0.25, 0, 6.3); ctx.fill();
  });
}

function leaf(ctx: Ctx, rnd: () => number, x: number, y: number, s: number, color: string) {
  const rot = rnd() * 6.283;
  put(ctx, x, y, s * 1.3, () => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(s * 0.18, s * 0.2, s * 0.62, s * 1.02, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.95, -s * 0.15, 0, s); ctx.quadraticCurveTo(-s * 0.95, -s * 0.15, 0, -s); ctx.fill();
    ctx.strokeStyle = 'rgba(60,20,0,0.35)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(0, -s * 0.9); ctx.lineTo(0, s * 1.05);
    for (let k = -2; k <= 2; k++) { if (!k) continue; ctx.moveTo(0, k * s * 0.3); ctx.lineTo(s * 0.5, k * s * 0.3 - s * 0.25); ctx.moveTo(0, k * s * 0.3); ctx.lineTo(-s * 0.5, k * s * 0.3 - s * 0.25); }
    ctx.stroke(); ctx.restore();
  });
}

function sparkle(ctx: Ctx, x: number, y: number, s: number, a: number, rgb = '255,255,255') {
  put(ctx, x, y, s * 3, () => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, s * 2.2); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s * 2.2, 0, 6.3); ctx.fill();
    if (a > 0.6) { ctx.strokeStyle = `rgba(${rgb},${a * 0.7})`; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x - s * 2.6, y); ctx.lineTo(x + s * 2.6, y); ctx.moveTo(x, y - s * 2.6); ctx.lineTo(x, y + s * 2.6); ctx.stroke(); }
  });
}

// ------------------------------------------------------------------ 종류별 타일

function meadow(ctx: Ctx, rnd: () => number, blossom: boolean) {
  shade(ctx, rnd, [3, 6], 0.2, 0.18, [10, 40, 20], [255, 255, 200]); // 크게 번지는 볕과 그늘
  shade(ctx, rnd, [14, 28], 0.1, 0.12, [0, 30, 10]);                   // 잔 얼룩
  for (let i = 0; i < 70; i++) { // 풀숲 덩어리
    const x = rnd() * TILE, y = rnd() * TILE;
    for (let k = 0; k < 9; k++) blade(ctx, rnd, x + (rnd() - 0.5) * 16, y + (rnd() - 0.5) * 10, 8 + rnd() * 9, 'rgba(10,60,25,0.32)', 1.3);
  }
  for (let i = 0; i < 4200; i++) {
    const r = rnd(), x = rnd() * TILE, y = rnd() * TILE;
    blade(ctx, rnd, x, y, 5 + rnd() * 10, r < 0.45 ? `rgba(255,255,220,${0.1 + rnd() * 0.2})` : r < 0.75 ? `rgba(0,40,10,${0.1 + rnd() * 0.18})` : `rgba(120,230,110,${0.12 + rnd() * 0.2})`, 0.8 + rnd() * 0.8);
  }
  for (let i = 0; i < 26; i++) { // 자갈
    const x = rnd() * TILE, y = rnd() * TILE, s = 2 + rnd() * 3.2;
    put(ctx, x, y, s * 2, () => {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x + 1, y + 1.5, s * 1.1, s * 0.8, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = 'rgba(176,170,160,0.85)'; ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.72, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(x - s * 0.25, y - s * 0.25, s * 0.45, s * 0.28, 0, 0, 6.3); ctx.fill();
    });
  }
  const petals = blossom ? ['rgba(255,190,214,0.95)', 'rgba(255,225,236,0.95)', 'rgba(255,160,196,0.95)'] : ['rgba(255,255,255,0.95)', 'rgba(255,238,140,0.95)', 'rgba(255,170,200,0.95)', 'rgba(200,170,255,0.95)'];
  for (let i = 0; i < (blossom ? 90 : 46); i++) flower(ctx, rnd, rnd() * TILE, rnd() * TILE, petals, 2 + rnd() * 1.8);
  if (blossom) for (let i = 0; i < 260; i++) { // 땅에 떨어진 꽃잎
    const x = rnd() * TILE, y = rnd() * TILE, s = 2.4 + rnd() * 2.2, rot = rnd() * 6.3;
    put(ctx, x, y, s * 2, () => { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = `rgba(${255},${190 + rnd() * 40},${210 + rnd() * 30},${0.7 + rnd() * 0.3})`; ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.55, 0, 0, 6.3); ctx.fill(); ctx.restore(); });
  }
}

function leafLitter(ctx: Ctx, rnd: () => number) {
  shade(ctx, rnd, [3, 6], 0.22, 0.34, [40, 15, 0], [255, 200, 120]);
  shade(ctx, rnd, [12, 24], 0.12, 0.14, [30, 10, 0]);
  for (let i = 0; i < 60; i++) { // 잔가지
    const x = rnd() * TILE, y = rnd() * TILE, a = rnd() * 6.28, l = 14 + rnd() * 26;
    put(ctx, x, y, l, () => { ctx.strokeStyle = 'rgba(50,28,12,0.55)'; ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); });
  }
  const cols = ['rgba(222,112,36,0.96)', 'rgba(196,64,32,0.96)', 'rgba(236,172,44,0.96)', 'rgba(150,88,30,0.96)', 'rgba(176,52,28,0.96)', 'rgba(214,142,40,0.96)'];
  for (let i = 0; i < 230; i++) leaf(ctx, rnd, rnd() * TILE, rnd() * TILE, 5 + rnd() * 6, cols[Math.floor(rnd() * cols.length)]);
}

function snowField(ctx: Ctx, rnd: () => number) {
  shade(ctx, rnd, [3, 6], 0.2, 0.2, [70, 100, 170], [255, 255, 255]);  // 푸른 그늘이 드리운 눈더미
  shade(ctx, rnd, [10, 20], 0.12, 0.1, [90, 120, 190]);
  for (let i = 0; i < 38; i++) { // 바람이 만든 결
    const x = rnd() * TILE, y = rnd() * TILE, w = 40 + rnd() * 90;
    put(ctx, x, y, w, () => { ctx.strokeStyle = `rgba(255,255,255,${0.16 + rnd() * 0.18})`; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + w * 0.3, y - 8, x + w * 0.7, y + 8, x + w, y); ctx.stroke(); });
  }
  for (let i = 0; i < 14; i++) { // 얼음 금
    let x = rnd() * TILE, y = rnd() * TILE; const pts: [number, number][] = [[x, y]];
    for (let k = 0; k < 7; k++) { x += (rnd() - 0.5) * 46; y += (rnd() - 0.5) * 46; pts.push([x, y]); }
    put(ctx, pts[0][0], pts[0][1], 160, () => { ctx.strokeStyle = 'rgba(150,200,255,0.42)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke(); });
  }
  for (let i = 0; i < 520; i++) sparkle(ctx, rnd() * TILE, rnd() * TILE, 0.7 + rnd() * 1.1, 0.35 + rnd() * 0.65, rnd() < 0.2 ? '190,225,255' : '255,255,255');
}

function poolTiles(ctx: Ctx, rnd: () => number) {
  const n = 8, s = TILE / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const g = ctx.createLinearGradient(x * s, y * s, x * s + s, y * s + s);
    g.addColorStop(0, `rgba(255,255,255,${0.1 + rnd() * 0.08})`); g.addColorStop(1, `rgba(0,40,70,${0.1 + rnd() * 0.08})`);
    ctx.fillStyle = g; ctx.fillRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
    ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.07})`; ctx.fillRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
  }
  ctx.strokeStyle = 'rgba(0,50,80,0.4)'; ctx.lineWidth = 2.4; ctx.beginPath();
  for (let i = 0; i <= n; i++) { ctx.moveTo(i * s, 0); ctx.lineTo(i * s, TILE); ctx.moveTo(0, i * s); ctx.lineTo(TILE, i * s); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = 0; i <= n; i++) { ctx.moveTo(i * s + 2, 0); ctx.lineTo(i * s + 2, TILE); ctx.moveTo(0, i * s + 2); ctx.lineTo(TILE, i * s + 2); }
  ctx.stroke();
  shade(ctx, rnd, [4, 8], 0.12, 0.1, [0, 50, 90], [200, 255, 250]);
}

function seabed(ctx: Ctx, rnd: () => number) {
  shade(ctx, rnd, [3, 5], 0.16, 0.34, [0, 20, 50], [150, 220, 255]);
  for (let i = 0; i < 46; i++) { // 모래 물결무늬
    const y = rnd() * TILE, ph = rnd() * 6.28, amp = 3 + rnd() * 5, a = 0.07 + rnd() * 0.1;
    ctx.strokeStyle = `rgba(190,235,255,${a})`; ctx.lineWidth = 2 + rnd() * 2; ctx.beginPath();
    for (let x = 0; x <= TILE; x += 8) { const yy = y + Math.sin((x / TILE) * 6.283 * 3 + ph) * amp; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }
    ctx.stroke();
  }
  for (let i = 0; i < 18; i++) { // 해초 다발
    const x = rnd() * TILE, y = rnd() * TILE;
    put(ctx, x, y, 40, () => {
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (k - 3) * 0.28 + (rnd() - 0.5) * 0.2, l = 22 + rnd() * 20;
        ctx.strokeStyle = `rgba(${20 + rnd() * 30},${150 + rnd() * 70},${120 + rnd() * 50},0.62)`; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 6, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
      }
    });
  }
  for (let i = 0; i < 34; i++) { // 조약돌·조개
    const x = rnd() * TILE, y = rnd() * TILE, s = 2 + rnd() * 4;
    put(ctx, x, y, s * 2, () => {
      ctx.fillStyle = 'rgba(0,10,30,0.35)'; ctx.beginPath(); ctx.ellipse(x + 1, y + 1.5, s * 1.1, s * 0.8, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = rnd() < 0.3 ? 'rgba(255,214,200,0.8)' : 'rgba(150,180,200,0.7)'; ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.75, rnd() * 3, 0, 6.3); ctx.fill();
    });
  }
}

/** 물결 빛(코스틱): 보로노이 가장자리 그물. 움직이며 겹쳐 반짝이는 층으로 쓴다 */
function causticNet(ctx: Ctx, rnd: () => number) {
  const N = 9, pts: [number, number][] = []; for (let i = 0; i < N * N; i++) pts.push([rnd(), rnd()]);
  const img = ctx.createImageData(TILE, TILE), d = img.data, cs = 1 / N;
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const u = x / TILE, v = y / TILE, cx = Math.floor(u * N), cy = Math.floor(v * N);
    let f1 = 9, f2 = 9;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gy = cy + oy, p = pts[(((gy % N) + N) % N) * N + (((gx % N) + N) % N)];
      const dx = (gx + p[0]) * cs - u, dy = (gy + p[1]) * cs - v, dist = Math.hypot(dx, dy);
      if (dist < f1) { f2 = f1; f1 = dist; } else if (dist < f2) f2 = dist;
    }
    const e = Math.max(0, 1 - (f2 - f1) * N * 3.2), i = (y * TILE + x) * 4;
    d[i] = 210; d[i + 1] = 245; d[i + 2] = 255; d[i + 3] = Math.pow(e, 3) * 255;
  }
  ctx.putImageData(img, 0, 0);
}

function circuit(ctx: Ctx, rnd: () => number) {
  const L = 32, n = TILE / L;
  ctx.fillStyle = 'rgba(255,255,255,0.03)'; // 은은한 패널
  for (let i = 0; i < 60; i++) ctx.fillRect(Math.floor(rnd() * n) * L, Math.floor(rnd() * n) * L, L * (1 + Math.floor(rnd() * 3)), L * (1 + Math.floor(rnd() * 2)));
  for (let pass = 0; pass < 2; pass++) {
    const rnd2 = mulberry(77); // 같은 경로를 두 번(넓고 흐린 빛 → 가는 선)
    for (let i = 0; i < 70; i++) {
      let x = Math.floor(rnd2() * n) * L, y = Math.floor(rnd2() * n) * L, dir = Math.floor(rnd2() * 4);
      const col = rnd2() < 0.5 ? '255,60,200' : '60,255,240', steps = 3 + Math.floor(rnd2() * 7);
      ctx.strokeStyle = `rgba(${col},${pass ? 0.75 : 0.13})`; ctx.lineWidth = pass ? 1.6 : 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let k = 0; k < steps; k++) {
        const len = L * (1 + Math.floor(rnd2() * 2)), nx = x + [len, 0, -len, 0][dir], ny = y + [0, len, 0, -len][dir];
        put(ctx, x, y, len + 8, () => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke(); });
        x = nx; y = ny; if (rnd2() < 0.45) dir = (dir + (rnd2() < 0.5 ? 1 : 3)) % 4;
      }
      if (pass) put(ctx, x, y, 8, () => { ctx.fillStyle = `rgba(${col},0.95)`; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 6.3); ctx.fill(); });
    }
  }
}

function deepSpace(ctx: Ctx, rnd: () => number) {
  const a = [makeNoise(3, rnd), makeNoise(6, rnd), makeNoise(12, rnd), makeNoise(24, rnd)], b = [makeNoise(4, rnd), makeNoise(8, rnd), makeNoise(16, rnd)];
  const img = ctx.createImageData(TILE, TILE), d = img.data;
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const u = x / TILE, v = y / TILE, n1 = Math.pow(Math.max(0, fbm(a, u, v) - 0.38) * 2.2, 1.6), n2 = Math.pow(Math.max(0, fbm(b, u, v) - 0.42) * 2.4, 1.5), i = (y * TILE + x) * 4;
    d[i] = Math.min(255, 150 * n1 + 40 * n2); d[i + 1] = Math.min(255, 60 * n1 + 150 * n2); d[i + 2] = Math.min(255, 255 * n1 + 220 * n2); d[i + 3] = Math.min(255, (n1 * 0.7 + n2 * 0.55) * 255);
  }
  const tmp = document.createElement('canvas'); tmp.width = tmp.height = TILE; tmp.getContext('2d')!.putImageData(img, 0, 0); ctx.drawImage(tmp, 0, 0);
  for (let i = 0; i < 700; i++) sparkle(ctx, rnd() * TILE, rnd() * TILE, 0.4 + rnd() * 0.6, 0.3 + rnd() * 0.6);
  for (let i = 0; i < 22; i++) sparkle(ctx, rnd() * TILE, rnd() * TILE, 1.4 + rnd() * 1.2, 0.95, rnd() < 0.5 ? '200,220,255' : '255,225,200');
}

function starsOnly(ctx: Ctx, rnd: () => number) {
  for (let i = 0; i < 260; i++) sparkle(ctx, rnd() * TILE, rnd() * TILE, 0.5 + rnd() * 0.9, 0.5 + rnd() * 0.5);
}

// ------------------------------------------------------------------ 도트(픽셀) 풍경: 128×128 도트를 4배로 키워 쓴다

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
class PX {
  readonly cv = document.createElement('canvas'); private g: CanvasRenderingContext2D;
  constructor(readonly n = 128) { this.cv.width = this.cv.height = n; this.g = this.cv.getContext('2d')!; }
  set(x: number, y: number, c: string) { const n = this.n; this.g.fillStyle = c; this.g.fillRect(((Math.round(x) % n) + n) % n, ((Math.round(y) % n) + n) % n, 1, 1); }
  rect(x: number, y: number, w: number, h: number, c: string) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  disc(cx: number, cy: number, r: number, c: string) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) this.set(cx + x, cy + y, c); }
  /** 값(0~1)을 팔레트(어두운 색 → 밝은 색)의 두 이웃 색 사이에서 디더링으로 고른다 */
  dither(x: number, y: number, v: number, pal: string[]) {
    const s = Math.max(0, Math.min(0.9999, v)) * (pal.length - 1), i = Math.floor(s), f = s - i;
    return f > BAYER[y & 3][x & 3] / 16 ? pal[i + 1] : pal[i];
  }
  fieldFill(rnd: () => number, cells: number[], pal: string[], contrast = 1.5) {
    const nzs = cells.map((c) => makeNoise(c, rnd));
    for (let y = 0; y < this.n; y++) for (let x = 0; x < this.n; x++) this.set(x, y, this.dither(x, y, (fbm(nzs, x / this.n, y / this.n) - 0.5) * contrast + 0.5, pal));
  }
}
function pixelTile(ctx: Ctx, rnd: () => number, draw: (px: PX, rnd: () => number) => void) {
  const px = new PX(); draw(px, rnd);
  ctx.imageSmoothingEnabled = false; ctx.drawImage(px.cv, 0, 0, TILE, TILE);
}
const pick = <T,>(rnd: () => number, a: T[]) => a[Math.floor(rnd() * a.length)];

function pxMeadow(px: PX, rnd: () => number) {
  px.fieldFill(rnd, [4, 8, 16], ['#3f8a3c', '#4f9d43', '#62b24e', '#79c95c', '#93dd72']);
  for (let i = 0; i < 90; i++) { const x = rnd() * 128, y = rnd() * 128; px.set(x, y, '#2f6f33'); px.set(x - 1, y - 1, '#2f6f33'); px.set(x + 1, y - 1, '#2f6f33'); px.set(x, y - 2, '#b4ef8a'); }
  const FL = [['#ffffff', '#ffe14d'], ['#ff8fb1', '#ffe14d'], ['#9ec5ff', '#ffffff'], ['#ff6b6b', '#ffe14d'], ['#ffd1f0', '#ffe14d']];
  for (let i = 0; i < 20; i++) { const [pc, cc] = pick(rnd, FL), x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128); px.set(x - 1, y, pc); px.set(x + 1, y, pc); px.set(x, y - 1, pc); px.set(x, y + 1, pc); px.set(x, y, cc); }
  for (let i = 0; i < 7; i++) { const x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128); px.rect(x, y + 2, 4, 1, '#4d5a4a'); px.rect(x, y, 4, 2, '#8d8d98'); px.rect(x, y, 3, 1, '#c8c8d2'); }
  for (let i = 0; i < 4; i++) { const x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128); px.rect(x - 1, y, 3, 1, '#d9443c'); px.set(x, y - 1, '#d9443c'); px.set(x - 1, y, '#ffffff'); px.set(x, y + 1, '#f3ead6'); px.set(x, y + 2, '#f3ead6'); }
}

function pxForest(px: PX, rnd: () => number) {
  px.fieldFill(rnd, [4, 8, 16], ['#1b4430', '#235637', '#2d6a42', '#397d4e'], 1.4);
  for (let i = 0; i < 60; i++) { const x = rnd() * 128, y = rnd() * 128; px.set(x, y, '#143324'); px.set(x + 1, y + 1, '#143324'); px.set(x - 1, y + 1, '#4f9a5a'); } // 양치식 잎
  for (let i = 0; i < 6; i++) { const x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128); px.rect(x - 1, y, 3, 1, '#c9473e'); px.set(x, y + 1, '#f3ead6'); px.set(x, y - 1, '#c9473e'); }
  for (let i = 0; i < 7; i++) { // 위에서 본 나무: 그림자 → 윤곽 → 잎 → 빛
    const x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128), r = 8 + Math.floor(rnd() * 5);
    px.disc(x + 4, y + 5, r, '#0f2a1c'); px.disc(x, y, r + 1, '#0e2a1b'); px.disc(x, y, r, '#2a7a45');
    for (let k = 0; k < 5; k++) { const a = k * 1.26 + rnd(); px.disc(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, Math.floor(r * 0.42), '#2f8a4c'); }
    px.disc(x - 2, y - 3, Math.max(2, Math.floor(r * 0.55)), '#44a85d'); px.disc(x - 3, y - 4, Math.max(1, Math.floor(r * 0.28)), '#80d472');
    for (let k = 0; k < 4; k++) px.set(x + (rnd() - 0.5) * r, y + (rnd() - 0.5) * r, '#1d5c34');
  }
}

function pxDesert(px: PX, rnd: () => number) {
  const pal = ['#d4a85f', '#e0ba72', '#ebcb88', '#f5dea6'], nzs = [makeNoise(4, rnd), makeNoise(8, rnd)];
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = fbm(nzs, x / 128, y / 128), band = ((y + Math.round(Math.sin(((x / 128) * 2 + v) * 6.283) * 4)) % 16 + 16) % 16;
    px.set(x, y, band < 2 ? '#c4964c' : band === 2 ? '#d2a45a' : px.dither(x, y, (v - 0.5) * 1.4 + 0.55, pal));
  }
  for (let i = 0; i < 70; i++) px.set(rnd() * 128, rnd() * 128, rnd() < 0.5 ? '#fff0c4' : '#b88a46');
  for (let i = 0; i < 5; i++) { // 위에서 본 선인장
    const x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128);
    px.disc(x + 2, y + 3, 5, '#b3883f'); px.disc(x, y, 5, '#1e5a2e'); px.disc(x, y, 4, '#3d8c48');
    for (let k = 0; k < 8; k++) { const a = k * 0.785; px.set(x + Math.cos(a) * 3, y + Math.sin(a) * 3, '#2a6f38'); }
    px.disc(x - 1, y - 1, 1, '#79c46a'); px.set(x, y, '#ff7aa8');
  }
  for (let i = 0; i < 9; i++) { const x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128); px.rect(x, y + 2, 4, 1, '#9e7a3f'); px.rect(x, y, 4, 2, '#9b8c7a'); px.rect(x, y, 2, 1, '#cfc2ad'); }
  for (let i = 0; i < 3; i++) { const x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128); px.rect(x, y, 5, 1, '#f4efe6'); px.set(x - 1, y - 1, '#f4efe6'); px.set(x - 1, y + 1, '#f4efe6'); px.set(x + 5, y - 1, '#f4efe6'); px.set(x + 5, y + 1, '#f4efe6'); } // 뼈
}

function pxSnow(px: PX, rnd: () => number) {
  px.fieldFill(rnd, [4, 8, 16], ['#c3d8ee', '#d4e5f6', '#e4f0fb', '#f6fbff'], 1.5);
  for (let i = 0; i < 5; i++) { const x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128), rx = 6 + Math.floor(rnd() * 5); // 언 웅덩이
    for (let dy = -4; dy <= 4; dy++) for (let dx = -rx; dx <= rx; dx++) if ((dx * dx) / (rx * rx) + (dy * dy) / 16 <= 1) px.set(x + dx, y + dy, dy < -1 ? '#bfe3f7' : '#92c9ea');
    px.rect(x - rx + 2, y - 2, 4, 1, '#ffffff'); }
  for (let i = 0; i < 8; i++) { // 위에서 본 소나무
    const x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128);
    px.disc(x + 3, y + 4, 8, '#9fb8d6'); px.disc(x, y, 8, '#1f5646'); px.disc(x, y, 7, '#2f7a62');
    for (let k = 0; k < 8; k++) { const a = k * 0.785; px.set(x + Math.cos(a) * 5, y + Math.sin(a) * 5, '#1f5646'); px.set(x + Math.cos(a + 0.4) * 3, y + Math.sin(a + 0.4) * 3, '#43a184'); }
    px.disc(x - 2, y - 2, 2, '#f6fbff'); px.disc(x + 3, y + 1, 1, '#f6fbff'); px.set(x, y + 3, '#f6fbff'); px.set(x - 4, y + 1, '#f6fbff');
  }
  for (let i = 0; i < 18; i++) { const x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128); px.set(x, y, '#aac3de'); px.set(x + 3, y + 1, '#aac3de'); } // 발자국
  for (let i = 0; i < 40; i++) px.set(rnd() * 128, rnd() * 128, '#ffffff');
}

function pxDungeon(px: PX, rnd: () => number) {
  const BW = 16, BH = 8, cols = ['#4a4757', '#555166', '#403d4d', '#4d4a5e'];
  for (let r = 0; r < 128 / BH; r++) for (let c = 0; c < 128 / BW; c++) {
    const x = c * BW + (r % 2) * (BW / 2), y = r * BH, col = pick(rnd, cols);
    px.rect(x, y, BW, BH, '#2b2933'); px.rect(x + 1, y + 1, BW - 1, BH - 1, col); px.rect(x + 1, y + 1, BW - 1, 1, '#6a667d'); px.rect(x + 1, y + 1, 1, BH - 1, '#625e75'); px.rect(x + 1, y + BH - 1, BW - 1, 1, '#34323f');
    for (let k = 0; k < 3; k++) px.set(x + 2 + rnd() * (BW - 4), y + 2 + rnd() * (BH - 4), rnd() < 0.5 ? '#3a3846' : '#5f5b72');
  }
  for (let i = 0; i < 10; i++) { let x = rnd() * 128, y = rnd() * 128; for (let k = 0; k < 14; k++) { px.set(x, y, '#1f1d27'); x += rnd() < 0.5 ? 1 : -1; y += rnd() < 0.7 ? 1 : 0; } } // 금
  for (let i = 0; i < 12; i++) { const x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128); for (let k = 0; k < 9; k++) px.set(x + (rnd() - 0.5) * 7, y + (rnd() - 0.5) * 4, rnd() < 0.5 ? '#3d6b3a' : '#55883f'); } // 이끼
  for (let i = 0; i < 3; i++) { const x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128); px.rect(x, y, 5, 4, '#e8e2d0'); px.set(x + 1, y + 1, '#2b2933'); px.set(x + 3, y + 1, '#2b2933'); px.set(x + 2, y + 3, '#2b2933'); px.rect(x + 1, y + 4, 3, 1, '#e8e2d0'); } // 해골
}

// ------------------------------------------------------------------ 콜로세움·전투장

function sandTile(ctx: Ctx, rnd: () => number) {
  shade(ctx, rnd, [3, 6], 0.2, 0.22, [120, 70, 20], [255, 240, 200]);
  shade(ctx, rnd, [14, 28], 0.08, 0.08, [110, 60, 10]);
  for (let i = 0; i < 3800; i++) { ctx.fillStyle = rnd() < 0.5 ? `rgba(255,244,210,${0.15 + rnd() * 0.3})` : `rgba(110,70,30,${0.12 + rnd() * 0.25})`; ctx.fillRect(rnd() * TILE, rnd() * TILE, 1 + rnd(), 1 + rnd()); }
  for (let i = 0; i < 15; i++) { // 갈퀴로 고른 결
    const y = rnd() * TILE, ph = rnd() * 6.28, amp = 4 + rnd() * 6;
    for (const [dy, col] of [[0, 'rgba(90,55,20,0.14)'], [2.4, 'rgba(255,240,200,0.16)']] as const) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let x = 0; x <= TILE; x += 8) { const yy = y + dy + Math.sin((x / TILE) * 6.283 * 2 + ph) * amp; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }
      ctx.stroke();
    }
  }
  for (let i = 0; i < 40; i++) { // 발자국
    const x = rnd() * TILE, y = rnd() * TILE, a = rnd() * 6.28;
    put(ctx, x, y, 16, () => { ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = 'rgba(90,55,20,0.2)'; ctx.beginPath(); ctx.ellipse(-3, 0, 2.2, 4, 0, 0, 6.3); ctx.ellipse(3, 5, 2.2, 4, 0, 0, 6.3); ctx.fill(); ctx.restore(); });
  }
  for (let i = 0; i < 8; i++) { const x = rnd() * TILE, y = rnd() * TILE, r = 20 + rnd() * 28; put(ctx, x, y, r, () => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(70,40,15,0.18)'); g.addColorStop(1, 'rgba(70,40,15,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill(); }); }
  for (let i = 0; i < 20; i++) { const x = rnd() * TILE, y = rnd() * TILE, s = 1.5 + rnd() * 2.5; put(ctx, x, y, s * 2, () => { ctx.fillStyle = 'rgba(60,40,20,0.3)'; ctx.beginPath(); ctx.ellipse(x + 1, y + 1, s, s * 0.7, 0, 0, 6.3); ctx.fill(); ctx.fillStyle = 'rgba(190,170,140,0.9)'; ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.7, 0, 0, 6.3); ctx.fill(); }); }
}

function stoneTile(ctx: Ctx, rnd: () => number) {
  shade(ctx, rnd, [3, 8], 0.14, 0.22, [10, 10, 20], [230, 235, 250]);
  const n = 4, s = TILE / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    ctx.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${rnd() * 0.07})` : `rgba(0,0,0,${rnd() * 0.12})`; ctx.fillRect(x * s, y * s, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x * s + 3, y * s + 3, s - 6, 2); ctx.fillRect(x * s + 3, y * s + 3, 2, s - 6); // 위·왼쪽 빛
    ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.fillRect(x * s + 3, y * s + s - 5, s - 6, 2); ctx.fillRect(x * s + s - 5, y * s + 3, 2, s - 6);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3; ctx.beginPath();
  for (let i = 0; i <= n; i++) { ctx.moveTo(i * s, 0); ctx.lineTo(i * s, TILE); ctx.moveTo(0, i * s); ctx.lineTo(TILE, i * s); }
  ctx.stroke();
  for (let i = 0; i < 9; i++) { let x = rnd() * TILE, y = rnd() * TILE; const pts: [number, number][] = [[x, y]]; for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 34; y += (rnd() - 0.3) * 34; pts.push([x, y]); }
    put(ctx, pts[0][0], pts[0][1], 120, () => { ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke(); }); }
  for (let i = 0; i < 18; i++) { const x = rnd() * TILE, y = rnd() * TILE, r = 8 + rnd() * 18; put(ctx, x, y, r, () => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(70,120,50,0.32)'); g.addColorStop(1, 'rgba(70,120,50,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill(); }); }
  for (let i = 0; i < 600; i++) { ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.25)'; ctx.fillRect(rnd() * TILE, rnd() * TILE, 1.5, 1.5); }
}

/** 관중석: 줄지어 앉은 사람들(위에서 본 머리와 어깨). frame 1은 일부가 팔을 들어 환호해 두 장을 번갈아 보이면 응원하는 듯하다 */
function crowdTile(ctx: Ctx, seed: number, frame: number) {
  const rnd = mulberry(seed), shirts = ['#c0392b', '#2e86c1', '#d4ac0d', '#27ae60', '#8e44ad', '#e67e22', '#ecf0f1', '#34495e', '#e84393'], skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'], hairs = ['#2c1a0e', '#4a2c14', '#111', '#8a5a2b', '#d9b36a', '#999'];
  const rows = 22, rowH = TILE / rows;
  for (let r = 0; r < rows; r++) {
    const y0 = r * rowH;
    ctx.fillStyle = 'rgba(30,22,18,0.92)'; ctx.fillRect(0, y0, TILE, rowH); // 계단
    ctx.fillStyle = 'rgba(255,235,200,0.12)'; ctx.fillRect(0, y0, TILE, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, y0 + rowH - 3, TILE, 3);
    for (let x = rnd() * 6; x < TILE; x += 15 + rnd() * 3) {
      if (rnd() < 0.08) continue; // 빈자리
      const cheer = rnd() < 0.35, bob = frame === 1 && cheer ? -2 : 0, cy = y0 + rowH * 0.55 + bob, shirt = pick(rnd, shirts), skin = pick(rnd, skins), hair = pick(rnd, hairs);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x + 1, cy + 2, 6.5, 4.5, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = shirt; ctx.beginPath(); ctx.ellipse(x, cy + 2, 6.5, 4.2, 0, 0, 6.3); ctx.fill();
      if (frame === 1 && cheer) { ctx.strokeStyle = skin; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 5, cy + 1); ctx.lineTo(x - 7, cy - 5); ctx.moveTo(x + 5, cy + 1); ctx.lineTo(x + 7, cy - 5); ctx.stroke(); }
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(x, cy - 1, 3.6, 0, 6.3); ctx.fill();
      ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(x, cy - 1.8, 3.7, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    }
  }
}

function volcanicTile(ctx: Ctx, rnd: () => number) {
  shade(ctx, rnd, [3, 6], 0.12, 0.42, [0, 0, 0], [150, 80, 60]);
  shade(ctx, rnd, [12, 24], 0.08, 0.14, [0, 0, 0], [110, 70, 60]);
  for (let i = 0; i < 1800; i++) { ctx.fillStyle = rnd() < 0.5 ? `rgba(255,150,100,${rnd() * 0.18})` : `rgba(0,0,0,${0.2 + rnd() * 0.3})`; ctx.fillRect(rnd() * TILE, rnd() * TILE, 1.5, 1.5); }
  for (let i = 0; i < 16; i++) { let x = rnd() * TILE, y = rnd() * TILE; const pts: [number, number][] = [[x, y]]; for (let k = 0; k < 8; k++) { x += (rnd() - 0.5) * 50; y += (rnd() - 0.5) * 50; pts.push([x, y]); }
    put(ctx, pts[0][0], pts[0][1], 200, () => { ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke(); }); }
  for (let i = 0; i < 24; i++) { const x = rnd() * TILE, y = rnd() * TILE, r = 6 + rnd() * 16; put(ctx, x, y, r, () => { ctx.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.2})`; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, rnd() * 3, 0, 6.3); ctx.fill(); ctx.fillStyle = 'rgba(255,170,110,0.08)'; ctx.beginPath(); ctx.ellipse(x - 1, y - 1, r * 0.6, r * 0.4, 0, 0, 6.3); ctx.fill(); }); }
}

/** 식어 가는 용암 틈(빛나는 선). 더하기 합성으로 깔아 맥박처럼 깜빡이게 한다 */
function lavaCracks(ctx: Ctx, rnd: () => number) {
  const paths: [number, number][][] = [];
  for (let i = 0; i < 12; i++) { let x = rnd() * TILE, y = rnd() * TILE, a = rnd() * 6.28; const pts: [number, number][] = [[x, y]]; for (let k = 0; k < 9; k++) { a += (rnd() - 0.5) * 1.1; x += Math.cos(a) * 28; y += Math.sin(a) * 28; pts.push([x, y]); } paths.push(pts); }
  for (const [w, col] of [[12, 'rgba(255,90,10,0.12)'], [5, 'rgba(255,120,20,0.5)'], [1.8, 'rgba(255,214,110,0.95)']] as const) for (const pts of paths) {
    put(ctx, pts[0][0], pts[0][1], 260, () => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke(); });
  }
}

function lavaFlow(ctx: Ctx, rnd: () => number) {
  const a = [makeNoise(4, rnd), makeNoise(8, rnd), makeNoise(16, rnd)], b = [makeNoise(3, rnd), makeNoise(6, rnd), makeNoise(12, rnd)];
  const img = ctx.createImageData(TILE, TILE), d = img.data;
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const u = x / TILE, v = y / TILE, ridge = 1 - Math.abs(fbm(a, u, v) * 2 - 1), hot = Math.pow(Math.max(0, ridge - 0.35) / 0.65, 1.6), cr = Math.max(0, Math.min(1, (fbm(b, u, v) - 0.45) * 7)), k = 1 - 0.82 * cr, i = (y * TILE + x) * 4;
    d[i] = (60 + 195 * hot) * k; d[i + 1] = (14 + 170 * hot * hot) * k; d[i + 2] = (6 + 50 * hot * hot * hot) * k; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

const MAKERS: Record<Tile, [number, (c: Ctx, r: () => number) => void]> = {
  meadow: [11, (c, r) => meadow(c, r, false)], blossom: [12, (c, r) => meadow(c, r, true)], leaf: [13, leafLitter], snow: [14, snowField],
  pool: [15, poolTiles], ocean: [16, seabed], neon: [17, circuit], space: [18, deepSpace], caustic: [19, causticNet], stars: [20, starsOnly],
  px_meadow: [21, (c, r) => pixelTile(c, r, pxMeadow)], px_forest: [22, (c, r) => pixelTile(c, r, pxForest)], px_desert: [23, (c, r) => pixelTile(c, r, pxDesert)],
  px_snow: [24, (c, r) => pixelTile(c, r, pxSnow)], px_dungeon: [25, (c, r) => pixelTile(c, r, pxDungeon)],
  sand: [26, sandTile], stone: [27, stoneTile], crowd: [28, (c) => crowdTile(c, 28, 0)], crowd2: [28, (c) => crowdTile(c, 28, 1)],
  volcanic: [29, volcanicTile], lavacracks: [30, lavaCracks], lavaflow: [31, lavaFlow],
};

/** 타일 한 장(처음 쓸 때 만들어 캐시한다) */
export function tileCanvas(kind: Tile): HTMLCanvasElement {
  let c = cache.get(kind);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = TILE;
  const [seed, make] = MAKERS[kind];
  make(c.getContext('2d')!, mulberry(seed));
  cache.set(kind, c);
  return c;
}

/** 크기를 줄여 주던 캐시 비우기(테스트·미리보기에서 쓸 수 있다) */
export function clearTiles() { cache.clear(); }

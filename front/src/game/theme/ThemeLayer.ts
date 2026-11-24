import { drawFloat, drawWeather, weatherTint } from './particles';
import { bgOf, DEFAULT_LOOK, type Bg } from './backgrounds';
import { makeLight, type Light } from './light';
import { lerp, rgb, rgba, type Float, type RGB } from './look';
import { PIXEL_TILES, TILE, tileCanvas, type Tile } from './tiles';

/**
 * 아레나 배경 테마(4.38). 서버 설정(`GET /api/arena-theme`)을 받아 두 가지를 따로 그린다.
 * - 배경(bg): 원래 아레나(0) / 자연 풍경 / 도트 풍경 / 전투장(콜로세움·돌 전투장·용암) / 이벤트. 바닥 질감과 아레나 둘레 장식을 정한다.
 * - 조명(lightMode·lightFixed): 해와 달의 위치와 그에 따른 색조·밝기·그림자. 현실 시각 자동 또는 낮·노을·밤·새벽 고정이고, 어떤 배경 위에도 얹힌다.
 * 날씨(weather)는 둘과 따로 위에 겹친다. 모두 꺼져 있으면(bg 0, 조명 0, 날씨 0) 원래 그림 그대로다.
 */
export interface ThemeConfig {
  bg: number; lightMode: number; lightFixed: number; weatherMode: number; weather: number; lat: number; lon: number; nowMs: number;
}

const rnd2 = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
type Ctx = CanvasRenderingContext2D;
const WALL = 240; // 콜로세움·전투장 벽 두께(월드 단위)

/** 위(북쪽) 벽 기준으로 그린 그림을 네 벽에 돌려 그린다. 아레나가 정사각형이라 90°씩 돌리면 같은 자리에 온다 */
function eachSide(ctx: Ctx, fn: (k: number) => void) { for (let k = 0; k < 4; k++) { ctx.save(); ctx.rotate((k * Math.PI) / 2); fn(k); ctx.restore(); } }
/** k번째 벽의 지역 좌표(그 벽이 위쪽이 되게 돌린 좌표)에서 보이는 범위 */
function localRange(k: number, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  switch (k) { case 0: return [x0, y0, x1, y1]; case 1: return [y0, -x1, y1, -x0]; case 2: return [-x1, -y1, -x0, -y0]; default: return [-y1, x0, -y0, x1]; }
}

export class ThemeLayer {
  private cfg: ThemeConfig | null = null;
  private cfgAt = 0;
  private bg: Bg | null = null;
  private light: Light | null = null;
  private lightAt = -1e9;
  private previewHour: number | null = null;
  private pats = new WeakMap<Ctx, Map<Tile, CanvasPattern>>();
  constructor(private still: boolean) {}

  setConfig(cfg: ThemeConfig | null) { this.cfg = cfg; this.cfgAt = performance.now(); this.lightAt = -1e9; this.bg = cfg ? bgOf(cfg.bg) : null; }
  /** 관리자 미리보기: 현실 시각 대신 이 시각(0~24시, 그 위치의 현지 시각)으로 그린다. null이면 현실 시각 */
  setPreviewHour(h: number | null) { this.previewHour = h; this.lightAt = -1e9; }

  /** 배경이나 조명이 켜져 있는지(둘 다 꺼져 있으면 호출하는 쪽이 원래 그림을 그린다) */
  get active() { return !!this.cfg && (this.bg !== null || this.cfg.lightMode > 0); }
  get weather() { return this.cfg?.weather ?? 0; }
  get hasEffects() { return this.active || this.weather > 0; }
  get gridColor() { if (!this.active) return null; const g = this.bg?.grid ?? DEFAULT_LOOK.grid; return rgba(g, g[3] * (this.bg ? 0.55 : 1)); }
  get wallColor() { if (!this.active) return null; return rgba(this.bg?.wall ?? DEFAULT_LOOK.wall); }

  /** 조명을 0.4초에 한 번만 다시 계산한다 */
  private update(now: number): Light | null {
    if (!this.cfg) return (this.light = null);
    if (now - this.lightAt >= 400) {
      this.lightAt = now;
      const c = this.cfg;
      this.light = makeLight(c.lightMode, c.lightFixed, c.lat, c.lon, c.nowMs + (now - this.cfgAt), this.previewHour);
    }
    return this.light;
  }

  /** 원이 바닥에 드리우는 그림자(반지름 대비 어긋남 dx·dy와 투명도). 조명이 꺼져 있으면 null(기본 그림자) */
  shadow(): { dx: number; dy: number; a: number } | null {
    const l = this.light;
    if (!l) return null;
    const m = Math.hypot(l.shadow.x, l.shadow.y) || 1, k = 0.09 + 0.2 * Math.min(1, l.shadow.len / 2.4);
    return { dx: (l.shadow.x / m) * k, dy: (l.shadow.y / m) * k, a: 0.13 + 0.2 * l.day };
  }

  // ------------------------------------------------------------------ 질감 깔기

  private pattern(ctx: Ctx, kind: Tile): CanvasPattern {
    let m = this.pats.get(ctx); if (!m) this.pats.set(ctx, (m = new Map()));
    let p = m.get(kind); if (!p) { p = ctx.createPattern(tileCanvas(kind), 'repeat')!; m.set(kind, p); }
    return p;
  }

  /**
   * 질감 타일을 사각형에 깐다. 일반 질감은 줌이 변해도 타일이 화면에서 300~600px로 유지되도록 두 배씩 큰 층 둘을 섞는다(번지거나 튀지 않게).
   * 도트 질감은 섞으면 모서리가 흐려지므로 한 층만 쓰고 보간하지 않는다. dx·dy는 월드 단위 이동(일렁임).
   */
  private tex(ctx: Ctx, kind: Tile, x0: number, y0: number, x1: number, y1: number, zoom: number, alpha: number, dx = 0, dy = 0, scaleMul = 1) {
    if (x1 <= x0 || y1 <= y0 || alpha <= 0.01) return;
    const W0 = 560 * scaleMul, lod = Math.max(0, Math.log2(300 / (W0 * zoom))), pat = this.pattern(ctx, kind), old = ctx.globalAlpha, smooth = ctx.imageSmoothingEnabled;
    ctx.fillStyle = pat;
    if (PIXEL_TILES.has(kind)) {
      const P = W0 * 2 ** Math.round(lod);
      ctx.imageSmoothingEnabled = false; pat.setTransform(new DOMMatrix([P / TILE, 0, 0, P / TILE, dx, dy]));
      ctx.globalAlpha = old * alpha; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.imageSmoothingEnabled = smooth;
    } else {
      const lv = Math.floor(lod), fr = lod - lv;
      for (const [l, a] of [[lv, 1 - fr], [lv + 1, fr]] as const) {
        if (a <= 0.02) continue;
        const P = W0 * 2 ** l; pat.setTransform(new DOMMatrix([P / TILE, 0, 0, P / TILE, dx, dy]));
        ctx.globalAlpha = old * alpha * a; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
    ctx.globalAlpha = old;
  }

  // ------------------------------------------------------------------ 바닥

  /**
   * 월드 좌표에서 아레나 바닥과 둘레. 바깥 → 둘레 장식 → 바닥 → 조명 색조 → 빛나는 것(물결·용암·횃불) → 벽 그림자와 테두리.
   * 아무것도 켜져 있지 않으면 false(호출하는 쪽이 원래 바닥을 그린다).
   */
  drawFloor(ctx: Ctx, half: number, view: { x: number; y: number }, zoom: number, w: number, h: number, now: number): boolean {
    const light = this.update(now), bg = this.bg;
    if (!bg && !light) return false;
    const t = this.still ? 0 : now / 1000, vw = w / 2 / zoom + 40, vh = h / 2 / zoom + 40;
    const vx0 = view.x - vw, vx1 = view.x + vw, vy0 = view.y - vh, vy1 = view.y + vh;
    const ax0 = Math.max(-half, vx0), ax1 = Math.min(half, vx1), ay0 = Math.max(-half, vy0), ay1 = Math.min(half, vy1);
    const night = light ? light.night : 0.15;
    ctx.save();
    if (!bg) { // 원래 아레나 + 조명만
      ctx.fillStyle = rgb(DEFAULT_LOOK.outside); ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
      ctx.fillStyle = rgb(DEFAULT_LOOK.floor); ctx.fillRect(ax0, ay0, ax1 - ax0, ay1 - ay0);
      this.grade(ctx, light, 0.75, vx0, vy0, vx1, vy1);
      this.walls(ctx, null, light, half, zoom, ax0, ay0, ax1, ay1);
      ctx.restore(); return true;
    }
    // 1) 바깥과 둘레 장식
    this.outside(ctx, bg, half, zoom, t, night, vx0, vy0, vx1, vy1);
    if (ax1 > ax0 && ay1 > ay0) {
      // 2) 바닥 색 → 질감 → 바닥 무늬
      const g = ctx.createLinearGradient(-half, -half, half, half);
      g.addColorStop(0, rgb(bg.a)); g.addColorStop(1, rgb(bg.b));
      ctx.fillStyle = g; ctx.fillRect(ax0, ay0, ax1 - ax0, ay1 - ay0);
      this.tex(ctx, bg.tile, ax0, ay0, ax1, ay1, zoom, 1);
      this.floorMarks(ctx, bg, half);
    }
    // 3) 조명 색조(바깥까지 함께). 스스로 빛나는 배경은 덜 받는다
    this.grade(ctx, light, bg.grade, vx0, vy0, vx1, vy1);
    if (ax1 > ax0 && ay1 > ay0) {
      // 4) 빛나는 것: 물결 빛·용암 틈·구름 그림자
      if (bg.caustic > 0) {
        ctx.globalCompositeOperation = 'lighter';
        this.tex(ctx, 'caustic', ax0, ay0, ax1, ay1, zoom, 0.34 * bg.caustic, t * 22, t * 14, 1.1);
        this.tex(ctx, 'caustic', ax0, ay0, ax1, ay1, zoom, 0.24 * bg.caustic, -t * 15, t * 19, 0.7);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (bg.glow) {
        const pulse = 0.42; // 밝기는 일정하게(주기적으로 밝아졌다 꺼지면 눈에 거슬린다). 흐르는 겹만 천천히 움직인다
        ctx.globalCompositeOperation = 'lighter';
        this.tex(ctx, bg.glow, ax0, ay0, ax1, ay1, zoom, pulse, 0, 0, 1.2);
        this.tex(ctx, bg.glow, ax0, ay0, ax1, ay1, zoom, pulse * 0.35, t * 4, t * 3, 0.8);
        ctx.globalCompositeOperation = 'source-over';
      }
      const cloud = bg.cloud * (light ? light.day * 0.9 + 0.1 : 0.7);
      if (cloud > 0.03) this.clouds(ctx, cloud, t, vx0, vy0, vx1, vy1);
    }
    this.lit(ctx, bg, half, t, night, vx0, vy0, vx1, vy1);
    // 5) 벽 둘레의 그림자와 테두리
    if (ax1 > ax0 && ay1 > ay0) this.walls(ctx, bg, light, half, zoom, ax0, ay0, ax1, ay1);
    ctx.restore();
    return true;
  }

  /** 조명 색조를 곱한다(multiply): 질감과 그림자는 살리고 색과 밝기만 바뀐다 */
  private grade(ctx: Ctx, light: Light | null, strength: number, x0: number, y0: number, x1: number, y1: number) {
    if (!light) return;
    const c: RGB = [lerp(255, light.color[0], strength), lerp(255, light.color[1], strength), lerp(255, light.color[2], strength)];
    if (c[0] > 250 && c[1] > 250 && c[2] > 250) return;
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = rgb(c); ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.globalCompositeOperation = 'source-over';
  }

  /** 아레나 바깥과 둘레 장식(전투장·도트 성벽). 월드 좌표 */
  private outside(ctx: Ctx, bg: Bg, half: number, zoom: number, t: number, night: number, vx0: number, vy0: number, vx1: number, vy1: number) {
    ctx.fillStyle = rgb(bg.outside); ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    const W = WALL;
    if (bg.frame === 'colosseum') {
      this.tex(ctx, Math.floor(t * 2.2) % 2 ? 'crowd2' : 'crowd', vx0, vy0, vx1, vy1, zoom, 1, 0, 0, 2.2); // 환호하는 관중석
      ctx.strokeStyle = 'rgba(20,14,10,0.6)'; ctx.lineWidth = 34;
      for (let k = 1; k <= 8; k++) { const d = W + 260 * k; ctx.strokeRect(-half - d, -half - d, (half + d) * 2, (half + d) * 2); }
      ctx.strokeStyle = 'rgba(255,225,180,0.1)'; ctx.lineWidth = 6;
      for (let k = 1; k <= 8; k++) { const d = W + 260 * k - 24; ctx.strokeRect(-half - d, -half - d, (half + d) * 2, (half + d) * 2); }
      eachSide(ctx, (k) => { // 멀수록 어둠에 묻히는 관중석
        const [lx0, , lx1] = localRange(k, vx0, vy0, vx1, vy1), g = ctx.createLinearGradient(0, -half - W, 0, -half - W - 2600);
        g.addColorStop(0, 'rgba(8,4,2,0.1)'); g.addColorStop(1, 'rgba(8,4,2,0.88)'); ctx.fillStyle = g; ctx.fillRect(lx0, -half - W - 2600, lx1 - lx0, 2600);
      });
    } else if (bg.frame === 'pit') {
      this.tex(ctx, 'stone', vx0, vy0, vx1, vy1, zoom, 0.8, 0, 0, 1.3);
      eachSide(ctx, (k) => { const [lx0, , lx1] = localRange(k, vx0, vy0, vx1, vy1), g = ctx.createLinearGradient(0, -half - W, 0, -half - W - 2000); g.addColorStop(0, 'rgba(6,6,12,0.2)'); g.addColorStop(1, 'rgba(6,6,12,0.9)'); ctx.fillStyle = g; ctx.fillRect(lx0, -half - W - 2000, lx1 - lx0, 2000); });
    } else if (bg.frame === 'lava') {
      this.tex(ctx, 'lavaflow', vx0, vy0, vx1, vy1, zoom, 0.88, t * 16, t * 7, 1.5); // 흐르는 용암
    } else if (bg.starsOut) {
      this.tex(ctx, 'space', vx0, vy0, vx1, vy1, zoom, 0.5, 0, 0, 1.6);
      this.tex(ctx, 'stars', vx0, vy0, vx1, vy1, zoom, 0.75, t * 6, 0, 1.3);
    } else if (night > 0.35 && bg.group === 'nature') {
      this.tex(ctx, 'stars', vx0, vy0, vx1, vy1, zoom, 0.55 * night, t * 4, 0, 1.3); // 밤의 자연 풍경은 둘레가 별 하늘로 이어진다
      this.tex(ctx, bg.tile, vx0, vy0, vx1, vy1, zoom, 0.3 * (1 - night));
    } else {
      this.tex(ctx, bg.tile, vx0, vy0, vx1, vy1, zoom, 0.5);
      ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    }
    // 둘레 구조물
    if (bg.frame === 'colosseum' || bg.frame === 'pit') {
      eachSide(ctx, (k) => {
        const [lx0, , lx1] = localRange(k, vx0, vy0, vx1, vy1), x0 = Math.max(lx0, -half - W), x1 = Math.min(lx1, half + W);
        if (x1 <= x0) return;
        this.tex(ctx, 'stone', x0, -half - W, x1, -half, zoom, 1, 0, 0, 0.55); // 벽 윗면
        const eg = ctx.createLinearGradient(0, -half - W, 0, -half); eg.addColorStop(0, 'rgba(255,238,205,0.28)'); eg.addColorStop(0.18, 'rgba(255,238,205,0)'); eg.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = eg; ctx.fillRect(x0, -half - W, x1 - x0, W);
        for (let x = Math.ceil(Math.max(x0, -half) / 900) * 900, n = 0; x <= Math.min(x1, half) && n < 30; x += 900, n++) { // 벽 윗면의 기둥 장식
          if (bg.frame === 'colosseum' && Math.abs(x) < 260) continue;
          ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 28 + 10, -half - W * 0.5 - 28 + 12, 56, 56); ctx.fillStyle = 'rgba(205,195,175,0.9)'; ctx.fillRect(x - 28, -half - W * 0.5 - 28, 56, 56); ctx.fillStyle = 'rgba(255,245,225,0.5)'; ctx.fillRect(x - 28, -half - W * 0.5 - 28, 56, 8);
        }
        if (bg.frame === 'colosseum') { // 출입문(쇠창살)
          if (-210 < x1 && 210 > x0) {
            ctx.fillStyle = '#0a0604'; ctx.fillRect(-210, -half - W, 420, W);
            ctx.strokeStyle = 'rgba(150,140,125,0.85)'; ctx.lineWidth = 7; ctx.beginPath(); for (let x = -190; x <= 190; x += 38) { ctx.moveTo(x, -half - W + 12); ctx.lineTo(x, -half - 6); }
            ctx.moveTo(-210, -half - W * 0.55); ctx.lineTo(210, -half - W * 0.55); ctx.stroke();
            ctx.strokeStyle = 'rgba(255,225,180,0.35)'; ctx.lineWidth = 12; ctx.strokeRect(-216, -half - W, 432, W);
          }
        } else { // 쇠창살 울타리와 뾰족한 끝
          const a = Math.max(x0, -half), b = Math.min(x1, half);
          ctx.strokeStyle = '#2b2f3a'; ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(a, -half - 44); ctx.lineTo(b, -half - 44); ctx.moveTo(a, -half - 150); ctx.lineTo(b, -half - 150); ctx.stroke();
          ctx.strokeStyle = 'rgba(200,210,235,0.25)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(a, -half - 50); ctx.lineTo(b, -half - 50); ctx.moveTo(a, -half - 156); ctx.lineTo(b, -half - 156); ctx.stroke();
          const s0 = Math.ceil(a / 120) * 120;
          for (let x = s0; x <= b; x += 120) { ctx.fillStyle = '#242833'; ctx.fillRect(x - 11, -half - 190, 22, 190); ctx.fillStyle = '#3a4050'; ctx.beginPath(); ctx.moveTo(x - 20, -half - 190); ctx.lineTo(x, -half - 260); ctx.lineTo(x + 20, -half - 190); ctx.fill(); ctx.fillStyle = 'rgba(220,230,255,0.35)'; ctx.fillRect(x - 11, -half - 190, 5, 190); }
        }
      });
      eachSide(ctx, () => { // 모서리 기둥
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(half + 18, -half - W + 18, W, W);
        ctx.fillStyle = '#9a8f80'; ctx.fillRect(half, -half - W, W, W); ctx.fillStyle = 'rgba(255,240,210,0.35)'; ctx.fillRect(half, -half - W, W, 14); ctx.fillRect(half, -half - W, 14, W);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(half + W - 16, -half - W, 16, W); ctx.fillRect(half, -half - 16, W, 16);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 4; ctx.strokeRect(half + 22, -half - W + 22, W - 44, W - 44);
      });
    } else if (bg.frame === 'lava') {
      ctx.strokeStyle = 'rgba(10,5,5,0.96)'; ctx.lineWidth = 110; ctx.lineJoin = 'miter'; ctx.strokeRect(-half - 20, -half - 20, half * 2 + 40, half * 2 + 40);
      ctx.strokeStyle = 'rgba(255,120,30,0.5)'; ctx.lineWidth = 7; ctx.strokeRect(-half - 76, -half - 76, half * 2 + 152, half * 2 + 152);
    } else if (bg.frame === 'brick') { // 도트 성벽: 두꺼운 갈색 띠 위에 번갈아 놓인 돌 머리
      const dark = rgb([bg.outside[0] * 2.6 + 20, bg.outside[1] * 2.4 + 16, bg.outside[2] * 2.2 + 12]), light = rgb([bg.wall[0] * 0.62, bg.wall[1] * 0.58, bg.wall[2] * 0.52]);
      ctx.lineJoin = 'miter'; ctx.strokeStyle = dark; ctx.lineWidth = 64; ctx.strokeRect(-half - 8, -half - 8, half * 2 + 16, half * 2 + 16);
      ctx.strokeStyle = light; ctx.lineWidth = 40; ctx.setLineDash([46, 46]); ctx.strokeRect(-half - 8, -half - 8, half * 2 + 16, half * 2 + 16); ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 10; ctx.strokeRect(-half + 20, -half + 20, half * 2 - 40, half * 2 - 40);
    }
  }

  /** 바닥 무늬(콜로세움 문양·돌 전투장 마법진). 월드 좌표 */
  private floorMarks(ctx: Ctx, bg: Bg, half: number) {
    if (bg.frame === 'colosseum') {
      const R = Math.min(half * 0.34, 1400);
      ctx.strokeStyle = 'rgba(105,58,22,0.32)'; ctx.lineWidth = 30; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
      ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(0, 0, R * 0.62, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, R * 1.18, 0, 7); ctx.stroke();
      ctx.lineWidth = 8; ctx.beginPath(); for (let i = 0; i < 24; i++) { const a = (i / 24) * 6.283; ctx.moveTo(Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); } ctx.stroke();
      ctx.strokeStyle = 'rgba(105,58,22,0.28)'; ctx.lineWidth = 14; ctx.strokeRect(-half + 130, -half + 130, (half - 130) * 2, (half - 130) * 2);
      ctx.strokeStyle = 'rgba(255,230,180,0.14)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, R + 18, 0, 7); ctx.stroke();
    }
  }

  /** 빛나는 장식(횃불·마법진). 조명 색조를 받지 않고 어둠 속에서 더 환하다 */
  private lit(ctx: Ctx, bg: Bg, half: number, t: number, night: number, vx0: number, vy0: number, vx1: number, vy1: number) {
    const W = WALL;
    if (bg.frame === 'pit') { // 마법진
      const R = Math.min(half * 0.3, 1200), pulse = 0.85 + 0.05 * Math.sin(t * 1.4);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (const [w, a] of [[34, 0.1], [14, 0.35], [5, 0.95]] as const) { ctx.strokeStyle = `rgba(120,190,255,${a * pulse})`; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke(); }
      ctx.strokeStyle = `rgba(255,170,90,${0.7 * pulse})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, R * 0.72, 0, 7); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283 + t * 0.08; const x = Math.cos(a) * R * 0.72, y = Math.sin(a) * R * 0.72; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.stroke();
      ctx.strokeStyle = `rgba(120,190,255,${0.8 * pulse})`; ctx.lineWidth = 7; ctx.beginPath(); for (let i = 0; i < 32; i++) { const a = (i / 32) * 6.283 + t * 0.08; ctx.moveTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9); ctx.lineTo(Math.cos(a) * R * (i % 2 ? 0.96 : 1.04), Math.sin(a) * R * (i % 2 ? 0.96 : 1.04)); } ctx.stroke();
      ctx.restore();
    }
    if (bg.frame === 'colosseum' || bg.frame === 'pit') { // 횃불 화로
      const heat = 0.34 + 0.66 * night;
      eachSide(ctx, (k) => {
        const [lx0, , lx1] = localRange(k, vx0, vy0, vx1, vy1), pts: (readonly [number, number])[] = [[-330, -half - W * 0.5], [330, -half - W * 0.5], [half + W * 0.5, -half - W * 0.5]];
        for (let x = Math.ceil(Math.max(lx0, -half) / 1800) * 1800, n = 0; x <= Math.min(lx1, half) && n < 8; x += 1800, n++) if (Math.abs(x) > 400) pts.push([x, -half - W * 0.5]); // 벽을 따라 일정 간격으로
        for (const [x, y] of pts) {
          if (x + 380 < lx0 || x - 380 > lx1) continue;
          ctx.save(); ctx.translate(x, y); ctx.rotate((-k * Math.PI) / 2); this.brazier(ctx, 0, 0, t, heat, x * 7 + y); ctx.restore(); // 불꽃은 화면 기준으로 위를 향한다
        }
      });
    }
    if (bg.frame === 'lava') { // 용암의 열기: 가장자리로 번지는 주황빛
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      eachSide(ctx, (k) => {
        const [lx0, , lx1] = localRange(k, vx0, vy0, vx1, vy1), g = ctx.createLinearGradient(0, -half, 0, -half + 520);
        g.addColorStop(0, 'rgba(255,110,30,0.13)'); g.addColorStop(1, 'rgba(255,110,30,0)'); ctx.fillStyle = g; ctx.fillRect(Math.max(lx0, -half), -half, Math.min(lx1, half) - Math.max(lx0, -half), 520);
        const o = ctx.createLinearGradient(0, -half - 110, 0, -half - 800); o.addColorStop(0, 'rgba(255,120,30,0.2)'); o.addColorStop(1, 'rgba(255,120,30,0)'); ctx.fillStyle = o; ctx.fillRect(lx0, -half - 800, lx1 - lx0, 690);
      });
      ctx.restore();
    }
  }

  private brazier(ctx: Ctx, x: number, y: number, t: number, heat: number, seed: number) {
    const fl = 0.8 + 0.2 * Math.sin(t * 9 + seed) + 0.1 * Math.sin(t * 17 + seed * 2), R = 380 * (0.55 + 0.6 * heat);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, R); g.addColorStop(0, `rgba(255,170,70,${0.42 * heat * fl})`); g.addColorStop(1, 'rgba(255,120,30,0)'); ctx.fillStyle = g; ctx.fillRect(x - R, y - R, R * 2, R * 2);
    ctx.restore();
    ctx.fillStyle = '#1d1812'; ctx.beginPath(); ctx.arc(x, y, 44, 0, 7); ctx.fill(); ctx.strokeStyle = '#6d5c46'; ctx.lineWidth = 9; ctx.stroke();
    ctx.fillStyle = '#3b2210'; ctx.beginPath(); ctx.arc(x, y, 30, 0, 7); ctx.fill();
    for (const [dx, dy, s, col] of [[-10, 4, 24, '#e8550f'], [8, 2, 28, '#ff8c1a'], [0, -4, 22, '#ffd24a']] as const) {
      const hgt = s * (0.8 + 0.4 * Math.sin(t * 11 + dx + seed)); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x + dx - s * 0.45, y + dy + 8); ctx.quadraticCurveTo(x + dx - s * 0.1, y + dy - hgt * 0.7, x + dx + Math.sin(t * 8 + seed) * 5, y + dy - hgt); ctx.quadraticCurveTo(x + dx + s * 0.15, y + dy - hgt * 0.5, x + dx + s * 0.45, y + dy + 8); ctx.fill();
    }
  }

  private clouds(ctx: Ctx, k: number, t: number, vx0: number, vy0: number, vx1: number, vy1: number) {
    const span = 9000;
    for (let i = 0; i < 6; i++) {
      const r = 650 + rnd2(i, 3) * 700, cx = (((i * 2371 + t * 26) % span) + span) % span - span / 2, cy = (rnd2(i, 5) - 0.5) * span * 0.8 + Math.sin(t * 0.03 + i) * 200;
      if (cx + r < vx0 || cx - r > vx1 || cy + r < vy0 || cy - r > vy1) continue;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(10,30,30,${0.17 * k})`); g.addColorStop(0.6, `rgba(10,30,30,${0.08 * k})`); g.addColorStop(1, 'rgba(10,30,30,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }

  /** 벽이 드리우는 그림자: 해의 반대쪽 벽에 길게(조명이 있을 때), 나머지는 안쪽으로 은은히. 그리고 테두리 빛 */
  private walls(ctx: Ctx, bg: Bg | null, light: Light | null, half: number, zoom: number, ax0: number, ay0: number, ax1: number, ay1: number) {
    const wh = bg ? bg.wallHeight : 0.25, night = light ? light.night : 0.15, D = 300 * Math.max(0.5, wh);
    const ao = `rgba(0,0,0,${(0.22 + night * 0.22) * Math.min(1, 0.45 + wh)})`;
    const grad = (x0: number, y0: number, x1: number, y1: number, c0: string) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, c0); g.addColorStop(1, 'rgba(0,0,0,0)'); return g; };
    if (ax0 < -half + D) { ctx.fillStyle = grad(-half, 0, -half + D, 0, ao); ctx.fillRect(-half, ay0, D, ay1 - ay0); }
    if (ax1 > half - D) { ctx.fillStyle = grad(half, 0, half - D, 0, ao); ctx.fillRect(half - D, ay0, D, ay1 - ay0); }
    if (ay0 < -half + D) { ctx.fillStyle = grad(0, -half, 0, -half + D, ao); ctx.fillRect(ax0, -half, ax1 - ax0, D); }
    if (ay1 > half - D) { ctx.fillStyle = grad(0, half, 0, half - D, ao); ctx.fillRect(ax0, half - D, ax1 - ax0, D); }
    if (light && wh > 0.2) { // 방향 그림자: 해가 비추는 반대쪽 벽 아래로 길게 드리운다(낮이 가장 진하고, 밤에는 달빛이라 옅다)
      const m = Math.hypot(light.shadow.x, light.shadow.y) || 1, sx = (light.shadow.x / m) * light.shadow.len, sy = (light.shadow.y / m) * light.shadow.len;
      const S = 520 * wh, a = 0.12 + 0.34 * light.day, col = `rgba(6,10,22,${a})`;
      const dl = sx * S, dr = -sx * S, dt = sy * S, db = -sy * S;
      if (dl > 24 && ax0 < -half + dl) { ctx.fillStyle = grad(-half, 0, -half + dl, 0, col); ctx.fillRect(-half, ay0, dl, ay1 - ay0); }
      if (dr > 24 && ax1 > half - dr) { ctx.fillStyle = grad(half, 0, half - dr, 0, col); ctx.fillRect(half - dr, ay0, dr, ay1 - ay0); }
      if (dt > 24 && ay0 < -half + dt) { ctx.fillStyle = grad(0, -half, 0, -half + dt, col); ctx.fillRect(ax0, -half, ax1 - ax0, dt); }
      if (db > 24 && ay1 > half - db) { ctx.fillStyle = grad(0, half, 0, half - db, col); ctx.fillRect(ax0, half - db, ax1 - ax0, db); }
    }
    if (bg && (bg.frame === 'colosseum' || bg.frame === 'pit' || bg.frame === 'lava' || bg.frame === 'brick')) return; // 물리적인 벽이 있으면 테두리 빛은 없다
    const wc = bg ? bg.wall : DEFAULT_LOOK.wall;
    if (bg) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = rgba(wc, wc[3] * 0.13); ctx.lineWidth = Math.max(26 / zoom, 70); ctx.strokeRect(-half, -half, half * 2, half * 2);
      ctx.strokeStyle = rgba(wc, wc[3] * 0.3); ctx.lineWidth = Math.max(10 / zoom, 26); ctx.strokeRect(-half, -half, half * 2, half * 2);
    }
  }

  // ------------------------------------------------------------------ 화면 전체 효과

  /** 화면 전체: 비네트·햇살 띠·떠다니는 입자·날씨(월드 그림 위) */
  drawOverlay(ctx: Ctx, w: number, h: number, now: number) {
    const l = this.update(now), wx = this.weather, bg = this.bg;
    if (!bg && !l && wx <= 0) return;
    if (bg || l) {
      const night = l ? l.night : 0.12;
      if (l && bg && bg.cloud > 0 && l.day > 0.05) this.beams(ctx, w, h, now, l.day * Math.min(1, bg.cloud + 0.3));
      const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) * 0.58);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${0.16 + night * 0.5})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
      drawFloat(ctx, (bg ? bg.float : 'none') as Float, w, h, now, this.still);
    }
    const tint = weatherTint(wx);
    if (tint) { ctx.fillStyle = rgba(tint); ctx.fillRect(0, 0, w, h); }
    drawWeather(ctx, wx, w, h, now, this.still);
  }

  /** 낮의 햇살: 대각선으로 느리게 흔들리는 밝은 띠 */
  private beams(ctx: Ctx, w: number, h: number, now: number, k: number) {
    const t = this.still ? 0 : now / 1000, span = Math.max(w, h) * 1.4;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(w * 0.5, h * 0.5); ctx.rotate(-0.5);
    for (let i = -3; i <= 3; i++) {
      const bw = span * (0.05 + 0.03 * rnd2(i, 4)), x = i * span * 0.18 + Math.sin(t * 0.15 + i) * 40;
      const g = ctx.createLinearGradient(x - bw, 0, x + bw, 0);
      g.addColorStop(0, 'rgba(255,250,215,0)'); g.addColorStop(0.5, `rgba(255,236,190,${0.085 * k})`); g.addColorStop(1, 'rgba(255,250,215,0)');
      ctx.fillStyle = g; ctx.fillRect(x - bw, -span, bw * 2, span * 2);
    }
    ctx.restore();
  }
}

export { WEATHER_NAMES } from './particles';

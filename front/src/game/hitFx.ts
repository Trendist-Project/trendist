/**
 * 타격감 연출(4.39): 처치·공격 성공·피격·죽음의 순간에 화면 흔들림, 가장자리 번쩍임, 튀는 파편, 확대 튕김, 큰 글자 배너를 더한다.
 * 모두 화면에만 있는 꾸밈이다(서버·판정과 무관). 움직임을 줄이는 설정(prefers-reduced-motion)이면 흔들림·확대 튕김·파편을 빼고 번쩍임만 약하게 낸다.
 */
interface Part { x: number; y: number; vx: number; vy: number; at: number; life: number; size: number; color: string }
interface Flash { rgb: string; at: number; ms: number; a: number }
interface Banner { text: string; sub?: string; color: string; at: number; ms: number }

const PART_MAX = 140;

export class HitFx {
  private parts: Part[] = [];
  private flashes: Flash[] = [];
  private banner: Banner | null = null;
  private shakeAt = -1e9; private shakeMs = 1; private shakePow = 0;
  private punchAt = -1e9; private punchMs = 1; private punchAmt = 0;
  constructor(private still: boolean) {}

  shake(pow: number, ms: number) { if (this.still) return; this.shakeAt = performance.now(); this.shakeMs = ms; this.shakePow = Math.max(this.shakePow * this.left(performance.now()), pow); }
  private left(now: number) { return Math.max(0, 1 - (now - this.shakeAt) / this.shakeMs); }
  punch(amt: number, ms: number) { if (this.still) return; this.punchAt = performance.now(); this.punchMs = ms; this.punchAmt = amt; }
  flash(rgb: string, ms: number, a: number) { this.flashes.push({ rgb, at: performance.now(), ms, a: this.still ? a * 0.5 : a }); if (this.flashes.length > 6) this.flashes.shift(); }
  announce(text: string, color: string, sub?: string) { this.banner = { text, sub, color, at: performance.now(), ms: 1700 }; }

  /** 점 (x, y)에서 반지름 r 둘레로 파편이 튄다(월드 좌표) */
  burst(x: number, y: number, r: number, color: string, n: number) {
    if (this.still) return;
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (0.9 + Math.random() * 2.2) * Math.max(80, r * 3.2);
      this.parts.push({ x: x + Math.cos(a) * r * 0.6, y: y + Math.sin(a) * r * 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, at: now, life: 420 + Math.random() * 380, size: 3 + Math.random() * 5, color });
    }
    if (this.parts.length > PART_MAX) this.parts.splice(0, this.parts.length - PART_MAX);
  }

  shakeOffset(now: number): { x: number; y: number } {
    const k = this.left(now);
    if (k <= 0) return { x: 0, y: 0 };
    const p = this.shakePow * k * k;
    return { x: (Math.random() * 2 - 1) * p, y: (Math.random() * 2 - 1) * p };
  }
  zoomMul(now: number): number {
    const k = (now - this.punchAt) / this.punchMs;
    return k < 0 || k >= 1 ? 1 : 1 + this.punchAmt * Math.sin(k * Math.PI);
  }

  /** 월드 좌표의 파편(모든 원 위). z는 화면 배율 */
  drawWorld(ctx: CanvasRenderingContext2D, now: number, z: number) {
    if (this.parts.length === 0) return;
    this.parts = this.parts.filter((p) => now - p.at < p.life);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of this.parts) {
      const age = (now - p.at) / 1000, k = (now - p.at) / p.life, damp = 1 - 0.5 * k;
      const s = (p.size / z) * (1 - k * 0.7); // 크기는 화면 픽셀 기준(줌과 무관하게 같은 굵기)
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x + p.vx * age * damp - s / 2, p.y + p.vy * age * damp - s / 2, s, s);
    }
    ctx.restore();
  }

  /** 화면 좌표: 가장자리 번쩍임과 큰 글자 배너 */
  drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number, now: number) {
    this.flashes = this.flashes.filter((f) => now - f.at < f.ms);
    for (const f of this.flashes) {
      const k = (now - f.at) / f.ms, a = f.a * (1 - k) * (1 - k);
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.55);
      g.addColorStop(0, `rgba(${f.rgb},0)`); g.addColorStop(1, `rgba(${f.rgb},${a})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    const b = this.banner;
    if (!b) return;
    const k = (now - b.at) / b.ms;
    if (k >= 1) { this.banner = null; return; }
    const pop = this.still ? 1 : 1 + 0.45 * Math.max(0, 1 - k * 7) ** 2, fade = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
    const fs = Math.max(28, Math.min(w * 0.085, 64)) * pop;
    ctx.save(); ctx.globalAlpha = fade; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${fs}px "Noto Sans KR", system-ui, sans-serif`; ctx.lineJoin = 'round'; ctx.lineWidth = fs * 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    const y = h * 0.24;
    ctx.strokeText(b.text, w / 2, y); ctx.fillStyle = b.color; ctx.fillText(b.text, w / 2, y);
    if (b.sub) {
      const sf = fs * 0.36; ctx.font = `700 ${sf}px "Noto Sans KR", system-ui, sans-serif`; ctx.lineWidth = sf * 0.2;
      ctx.strokeText(b.sub, w / 2, y + fs * 0.7); ctx.fillStyle = '#ffffff'; ctx.fillText(b.sub, w / 2, y + fs * 0.7);
    }
    ctx.restore();
  }
}

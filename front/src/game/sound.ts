/**
 * 효과음과 배경음(4.39). 소리 파일 없이 Web Audio로 그 자리에서 만든다(설치·내려받기 없음, 용량 0).
 * 브라우저는 사용자가 한 번 누르거나 키를 누를 때까지 소리를 막으므로, 첫 입력 때 컨텍스트를 깨운다.
 * 효과음은 기본 켜짐, 배경음은 기본 꺼짐이다. 둘 다 이 브라우저에 기억한다. 같은 소리는 짧은 시간에 몰려도 한 번만 낸다.
 */
export type Sfx = 'plus' | 'gain' | 'lose' | 'hit' | 'kill' | 'dash' | 'levelup' | 'boss' | 'orb' | 'skill' | 'hurt' | 'death' | 'combo' | 'merge' | 'mergeBonus';

const SFX_KEY = 'trendist.sfx', BGM_KEY = 'trendist.bgm';
const VOL_KEYS = { master: 'trendist.vol.master', sfx: 'trendist.vol.sfx', bgm: 'trendist.vol.bgm' } as const;
export type VolumeKind = keyof typeof VOL_KEYS;
export const DEFAULT_VOLUME: Record<VolumeKind, number> = { master: 80, sfx: 80, bgm: 50 };
const read = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const write = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* 무시 */ } };
const readVol = (k: VolumeKind) => { try { const v = localStorage.getItem(VOL_KEYS[k]); const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : DEFAULT_VOLUME[k]; } catch { return DEFAULT_VOLUME[k]; } };

let ctx: AudioContext | null = null;
/** 마스터 → (효과음 버스, 배경음 버스) → 출력. 음량 0~100은 귀에 고르게 들리도록 제곱 곡선으로 바꾼다 */
let master: GainNode | null = null, sfxBus: GainNode | null = null, bgmBus: GainNode | null = null;
let out: AudioNode | null = null; // 지금 소리를 내보낼 버스(효과음·배경음이 번갈아 쓴다)
let sfxOn = read(SFX_KEY, true);
let bgmOn = read(BGM_KEY, false);
const vol: Record<VolumeKind, number> = { master: readVol('master'), sfx: readVol('sfx'), bgm: readVol('bgm') };
const curve = (v: number) => (v / 100) * (v / 100);
function applyVolumes() {
  if (!ctx || !master || !sfxBus || !bgmBus) return;
  const now = ctx.currentTime;
  master.gain.setTargetAtTime(curve(vol.master), now, 0.03); sfxBus.gain.setTargetAtTime(curve(vol.sfx), now, 0.03); bgmBus.gain.setTargetAtTime(curve(vol.bgm), now, 0.03);
}
const last = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

function ensure(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new AudioContext(); master = ctx.createGain(); sfxBus = ctx.createGain(); bgmBus = ctx.createGain();
      sfxBus.connect(master); bgmBus.connect(master); master.connect(ctx.destination); applyVolumes();
    } catch { return null; }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

/** 첫 입력에 한 번 깨운다(브라우저의 자동 재생 제한). 게임 화면이 열릴 때 한 번 부른다 */
export function unlockAudio() {
  const wake = () => { ensure(); if (bgmOn) startBgm(); window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };
  window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake);
  return () => { window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };
}

export interface SoundState { sfx: boolean; bgm: boolean; master: number; sfxVol: number; bgmVol: number }
export const soundState = (): SoundState => ({ sfx: sfxOn, bgm: bgmOn, master: vol.master, sfxVol: vol.sfx, bgmVol: vol.bgm });
/** 소리가 실제로 나는 상태인지(마스터가 0이거나 둘 다 꺼져 있으면 false). 버튼 아이콘이 쓴다 */
export const soundAudible = (s: SoundState) => s.master > 0 && ((s.sfx && s.sfxVol > 0) || (s.bgm && s.bgmVol > 0));
export function setVolume(kind: VolumeKind, v: number) {
  vol[kind] = Math.max(0, Math.min(100, Math.round(v)));
  try { localStorage.setItem(VOL_KEYS[kind], String(vol[kind])); } catch { /* 무시 */ }
  ensure(); applyVolumes(); notify();
}
export function resetVolumes() { for (const k of Object.keys(DEFAULT_VOLUME) as VolumeKind[]) setVolume(k, DEFAULT_VOLUME[k]); }
export function subscribeSound(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
export function setSfx(on: boolean) { sfxOn = on; write(SFX_KEY, on); if (on) ensure(); notify(); }
export function setBgm(on: boolean) { bgmOn = on; write(BGM_KEY, on); if (on) { ensure(); startBgm(); } else stopBgm(); notify(); }

// ------------------------------------------------------------------ 소리 재료

function tone(c: AudioContext, freq: number, at: number, dur: number, type: OscillatorType, vol: number, to?: number) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, at);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(out!); o.start(at); o.stop(at + dur + 0.02);
}

function noise(c: AudioContext, at: number, dur: number, vol: number, from: number, to: number) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur)), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.1;
  f.frequency.setValueAtTime(from, at); f.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + dur);
  g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f); f.connect(g); g.connect(out!); src.start(at); src.stop(at + dur);
}

const N = (semi: number) => 440 * Math.pow(2, (semi - 9) / 12); // 가온 다(0)를 기준으로 한 음 높이

/** 소리마다 다시 낼 수 있는 최소 간격(ms): 한꺼번에 몰려도 시끄럽지 않게 */
const GAP: Partial<Record<Sfx, number>> = { hit: 90, hurt: 120, skill: 70, plus: 60, orb: 100, merge: 300, mergeBonus: 300 };

const RECIPES: Record<Sfx, (c: AudioContext, t: number) => void> = {
  plus: (c, t) => { tone(c, N(7), t, 0.1, 'triangle', 0.18); tone(c, N(14), t + 0.07, 0.16, 'triangle', 0.18); },
  gain: (c, t) => { [0, 4, 7, 12].forEach((s, i) => tone(c, N(s + 7), t + i * 0.06, 0.18, 'triangle', 0.17)); },
  lose: (c, t) => { tone(c, N(5), t, 0.28, 'sawtooth', 0.12, N(-7)); },
  hit: (c, t) => { noise(c, t, 0.12, 0.28, 900, 220); tone(c, 150, t, 0.1, 'square', 0.1, 70); },
  hurt: (c, t) => { tone(c, 220, t, 0.16, 'sawtooth', 0.14, 90); noise(c, t, 0.1, 0.12, 600, 200); },
  kill: (c, t) => { noise(c, t, 0.22, 0.3, 1200, 120); tone(c, 110, t, 0.3, 'square', 0.16, 45); [0, 4, 7].forEach((s, i) => tone(c, N(s + 12), t + 0.1 + i * 0.07, 0.3, 'triangle', 0.16)); },
  death: (c, t) => { tone(c, N(4), t, 0.5, 'sawtooth', 0.14, N(-14)); noise(c, t, 0.4, 0.14, 500, 60); },
  dash: (c, t) => { noise(c, t, 0.22, 0.2, 400, 3200); },
  levelup: (c, t) => { [0, 4, 7, 12, 16].forEach((s, i) => tone(c, N(s + 7), t + i * 0.07, 0.3, 'triangle', 0.17)); },
  boss: (c, t) => { tone(c, N(-24), t, 0.9, 'sawtooth', 0.15, N(-26)); tone(c, N(-17), t + 0.45, 0.9, 'sawtooth', 0.13, N(-19)); },
  orb: (c, t) => { [12, 16, 19, 24].forEach((s, i) => tone(c, N(s), t + i * 0.045, 0.14, 'sine', 0.15)); },
  skill: (c, t) => { tone(c, 600, t, 0.14, 'square', 0.08, 1500); },
  // 키워드 합성(4.44): 두 소리가 모여 하나로 울리는 소리. 보너스는 반짝이는 높은 음이 이어진다
  merge: (c, t) => { tone(c, N(0), t, 0.22, 'triangle', 0.15, N(7)); tone(c, N(12), t, 0.22, 'triangle', 0.12, N(7)); tone(c, N(7), t + 0.2, 0.3, 'sine', 0.18); tone(c, N(19), t + 0.22, 0.28, 'triangle', 0.1); },
  mergeBonus: (c, t) => { RECIPES.merge(c, t); [12, 16, 19, 24, 28].forEach((s, i) => tone(c, N(s + 7), t + 0.35 + i * 0.07, 0.3, 'sine', 0.14)); noise(c, t + 0.35, 0.4, 0.05, 3000, 9000); },
  combo: (c, t) => { tone(c, N(12), t, 0.08, 'square', 0.1); tone(c, N(19), t + 0.06, 0.12, 'square', 0.1); },
};

/** 효과음 한 번. 꺼져 있거나 브라우저가 아직 막고 있으면 조용히 넘어간다 */
export function playSfx(name: Sfx) {
  if (!sfxOn) return;
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const now = performance.now(), gap = GAP[name] ?? 40;
  if (now - (last.get(name) ?? -1e9) < gap) return;
  last.set(name, now);
  out = sfxBus;
  try { RECIPES[name](c, c.currentTime + 0.005); } catch { /* 소리가 안 나도 게임은 계속 */ }
}

// ------------------------------------------------------------------ 배경음: 느린 코드 위에 오음계 선율이 가끔 떠오른다

const CHORDS = [[0, 4, 7], [-3, 0, 4], [-5, -1, 2], [-7, -3, 0]]; // 한 코드가 약 8초
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
let bgmTimer = 0, beat = 0;

function bgmStep() {
  const c = ctx;
  out = bgmBus;
  if (!c || !master || !bgmOn || c.state !== 'running') return;
  const t = c.currentTime + 0.05, chord = CHORDS[Math.floor(beat / 4) % CHORDS.length];
  if (beat % 4 === 0) chord.forEach((s) => tone(c, N(s - 12), t, 8.2, 'sine', 0.035));
  if (Math.random() < 0.7) tone(c, N(SCALE[Math.floor(Math.random() * SCALE.length)] + chord[0]), t + Math.random() * 0.6, 1.8, 'triangle', 0.03);
  beat++;
}
function startBgm() { if (bgmTimer || !ensure()) return; bgmStep(); bgmTimer = window.setInterval(bgmStep, 2000); }
function stopBgm() { window.clearInterval(bgmTimer); bgmTimer = 0; }

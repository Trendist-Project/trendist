import { solar, type Sun } from './sun';
import { lerp, type RGB } from './look';

/**
 * 조명(시간대): 해와 달의 위치를 정하고, 그에 따른 색조·밝기·그림자 방향을 계산한다(4.38). 배경(풍경)과는 따로여서 어떤 배경 위에도 같은 조명이 얹힌다.
 * lightMode 1은 서버 위치의 현실 시각으로, 2는 고정 시간대(낮·노을·밤·새벽)로 해·달 위치를 정한다.
 */
/** 해(달)의 방향. 화면에는 그리지 않고 그림자 방향 계산에만 쓴다. x·y는 화면 비율(0~1) */
export interface SkyBody { kind: 'sun' | 'moon'; x: number; y: number; alpha: number; warm: number }
export interface Light {
  /** 바닥에 곱하는 색조(multiply): 낮은 흰색, 노을은 주황, 밤은 짙은 남색 */
  color: RGB;
  /** 0 = 한낮, 1 = 깊은 밤(비네트·벽 그림자·횃불 불빛 세기) */
  night: number;
  /** 낮의 밝기 0~1(햇살·구름 그림자) */
  day: number;
  /** 그림자가 드리우는 방향(화면 기준, 해의 반대쪽)과 길이 배수 */
  shadow: { x: number; y: number; len: number };
  sky: SkyBody | null;
}

const RAD = Math.PI / 180;
export const LIGHT_NAMES: Record<number, string> = { 1: '낮', 2: '노을', 3: '밤', 4: '새벽' };

/** 고정 시간대의 해·달 위치(고도, 시간각) */
const FIXED: Record<number, Sun> = {
  1: { alt: 52, morning: true, hour: -18 },
  2: { alt: 3, morning: false, hour: 86 },
  3: { alt: -38, morning: false, hour: 24 },
  4: { alt: 3, morning: true, hour: -86 },
};

const KEYS_MORNING: [number, RGB][] = [[20, [255, 255, 255]], [8, [255, 247, 232]], [2, [255, 206, 176]], [-4, [204, 158, 196]], [-12, [104, 112, 176]], [-22, [58, 74, 132]]];
const KEYS_EVENING: [number, RGB][] = [[20, [255, 255, 255]], [8, [255, 244, 224]], [2, [255, 180, 132]], [-4, [196, 134, 156]], [-12, [100, 106, 172]], [-22, [58, 74, 132]]];

function gradeColor(alt: number, morning: boolean): RGB {
  const keys = morning ? KEYS_MORNING : KEYS_EVENING;
  if (alt >= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (alt >= keys[i][0]) { const [a0, c0] = keys[i - 1], [a1, c1] = keys[i], t = (a0 - alt) / (a0 - a1); return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)]; }
  }
  return keys[keys.length - 1][1];
}

export function lightFrom(s: Sun): Light {
  const { alt, morning, hour } = s;
  const night = Math.min(1, Math.max(0, (-alt + 2) / 16)), day = Math.min(1, Math.max(0, (alt - 4) / 24));
  let sky: SkyBody | null = null;
  if (alt > -3) sky = { kind: 'sun', x: 0.5 + 0.42 * Math.sin(hour * RAD), y: 0.3 - 0.2 * Math.min(1, Math.max(0, alt / 55)), alpha: Math.min(1, (alt + 3) / 6), warm: Math.min(1, Math.max(0, (14 - alt) / 14)) };
  else if (alt < -6) { const mh = hour + 180; sky = { kind: 'moon', x: 0.5 + 0.42 * Math.sin(mh * RAD), y: 0.3 - 0.2 * Math.min(1, Math.max(0, -alt / 55)), alpha: Math.min(1, (-alt - 6) / 6), warm: 0 }; }
  // 해(또는 달)는 화면 위쪽에서 비춘다고 보고 그림자는 아래쪽·반대쪽으로. 해가 낮을수록 그림자가 길다
  const lightAlt = alt > -3 ? alt : Math.max(10, -alt * 0.6), sx = sky ? sky.x - 0.5 : 0, len = Math.min(2.4, Math.max(0.25, 1 / Math.tan(Math.max(8, lightAlt) * RAD) * 0.55));
  return { color: gradeColor(alt, morning), night, day, shadow: { x: -sx * 2.2, y: 1, len }, sky };
}

/** 설정과 시각으로 조명을 만든다. lightMode 0이면 null(조명 없음) */
export function makeLight(mode: number, fixed: number, lat: number, lon: number, ms: number, previewHour: number | null): Light | null {
  if (mode <= 0) return null;
  if (mode === 2) return lightFrom(FIXED[Math.max(1, Math.min(4, Math.round(fixed)))] ?? FIXED[1]);
  if (previewHour !== null) {
    const hour = (previewHour - 12) * 15, dec = 10 * RAD, la = lat * RAD;
    const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(hour * RAD)) / RAD;
    return lightFrom({ alt, morning: hour < 0, hour });
  }
  return lightFrom(solar(lat, lon, ms));
}

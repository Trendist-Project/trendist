import { api } from '../api/client';
import type { LevelBadge } from '../api/types';
import { TURTLE_BASE } from './turtle';

/**
 * 레벨별 성장 거북이 바탕색(DB levels, 4.9): 레벨 구간마다 색과 진하기가 다르고 100레벨은 무지개다.
 * 아레나·꾸미기 미리 보기·레벨 표시 아이콘이 같은 색을 쓰도록 한 곳에서 한 번만 받아 둔다. 실패하면 다음에 다시 시도한다.
 */
let badges: Map<number, LevelBadge> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function ensureLevelBadges(): Promise<void> {
  if (!loading) {
    loading = api.levelBadges()
      .then((list) => { badges = new Map(list.map((b) => [b.level, b])); listeners.forEach((f) => f()); })
      .catch(() => { loading = null; });
  }
  return loading;
}

export const levelBadges = () => badges;
export const levelBadge = (level: number): LevelBadge | null => badges?.get(level) ?? null;
export function subscribeLevelBadges(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

/** 꾸미지 않은(기본) 바탕색인지. 기본 바탕은 레벨 색을 따라간다 */
export const isDefaultBg = (bg: string | null | undefined) => !bg || bg.toLowerCase() === TURTLE_BASE;

const RAINBOW = ['#ff4d4d', '#ff9f1c', '#ffe14d', '#4cd964', '#3fa9ff', '#7b61ff', '#d65cff'];

/** 바탕 원을 칠한다: 레벨 색이 있으면 그 색과 진하기(무지개는 그라데이션, 진하기만큼 뒤가 비친다), 아직 못 받았으면 기본 초록 */
export function paintBase(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, badge: LevelBadge | null, fallback: string = TURTLE_BASE) {
  ctx.save();
  if (badge?.rainbow) {
    const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    RAINBOW.forEach((col, i) => g.addColorStop(i / (RAINBOW.length - 1), col));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = badge?.color ?? fallback;
    ctx.globalAlpha *= Math.max(0, Math.min(100, badge?.color ? badge.alpha : 100)) / 100;
  }
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

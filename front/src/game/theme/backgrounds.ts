import type { Float, RGB, RGBA } from './look';
import type { Tile } from './tiles';

/**
 * 아레나 배경(풍경) 목록(4.38). 서버 설정 `arena_bg`의 번호와 같다. 0은 지금까지의 원래 아레나(이 목록에 없고 코드가 그대로 그린다).
 * group: nature 자연 풍경 / pixel 도트 풍경 / arena 전투장 / event 이벤트.
 * frame: 아레나 둘레 장식(콜로세움 관중석·돌 전투장 쇠창살·용암 강·도트 성벽). grade: 조명 색조를 받는 정도(스스로 빛나는 배경은 낮게).
 */
export type Frame = 'none' | 'colosseum' | 'pit' | 'lava' | 'brick';
export interface Bg {
  id: number; name: string; group: 'nature' | 'pixel' | 'arena' | 'event';
  tile: Tile; a: RGB; b: RGB; outside: RGB; grid: RGBA; wall: RGBA;
  frame: Frame; float: Float; pixel: boolean; caustic: number; cloud: number; grade: number; wallHeight: number;
  /** 아레나 바깥을 별밭으로 */
  starsOut: boolean;
  /** 더하기 합성으로 깔아 맥박처럼 깜빡이는 빛 질감(용암 틈) */
  glow?: Tile;
}

const B = (id: number, name: string, group: Bg['group'], tile: Tile, a: RGB, b: RGB, outside: RGB, grid: RGBA, wall: RGBA, o: Partial<Bg> = {}): Bg =>
  ({ id, name, group, tile, a, b, outside, grid, wall, frame: 'none', float: 'none', pixel: false, caustic: 0, cloud: 0, grade: 1, wallHeight: 0.25, starsOut: false, ...o });

export const BACKGROUNDS: Bg[] = [
  // 자연 풍경(고품질 질감)
  B(1, '풀밭', 'nature', 'meadow', [150, 214, 140], [88, 172, 118], [24, 52, 40], [20, 70, 50, 0.16], [255, 255, 255, 0.85], { cloud: 1 }),
  B(2, '벚꽃 정원', 'nature', 'blossom', [198, 238, 168], [246, 202, 222], [54, 40, 56], [120, 60, 90, 0.14], [255, 240, 246, 0.85], { float: 'petals', cloud: 0.6 }),
  B(3, '가을 숲길', 'nature', 'leaf', [182, 112, 58], [128, 78, 42], [44, 26, 16], [70, 30, 10, 0.2], [255, 220, 170, 0.8], { float: 'leaves', cloud: 0.5 }),
  B(4, '설원', 'nature', 'snow', [226, 236, 247], [176, 200, 228], [18, 30, 50], [90, 120, 160, 0.18], [255, 255, 255, 0.95], { float: 'snow', cloud: 0.4 }),
  B(5, '바닷속', 'nature', 'ocean', [26, 112, 164], [10, 58, 108], [4, 20, 44], [170, 225, 255, 0.1], [190, 235, 255, 0.7], { float: 'bubbles', caustic: 0.75, grade: 0.5 }),
  B(6, '여름 수영장', 'nature', 'pool', [112, 216, 206], [64, 178, 184], [10, 52, 64], [10, 80, 90, 0.2], [255, 255, 255, 0.9], { caustic: 0.4 }),
  // 도트(픽셀) 풍경
  B(11, '도트 초원', 'pixel', 'px_meadow', [98, 178, 78], [79, 157, 67], [30, 44, 34], [20, 60, 30, 0.14], [255, 255, 255, 0.9], { pixel: true, frame: 'brick', cloud: 0.5 }),
  B(12, '도트 숲', 'pixel', 'px_forest', [45, 106, 66], [35, 86, 55], [14, 32, 22], [10, 40, 20, 0.16], [200, 240, 190, 0.8], { pixel: true, frame: 'brick' }),
  B(13, '도트 사막', 'pixel', 'px_desert', [235, 203, 136], [212, 168, 95], [60, 40, 22], [120, 80, 30, 0.16], [255, 236, 190, 0.9], { pixel: true, frame: 'brick', cloud: 0.3 }),
  B(14, '도트 설원', 'pixel', 'px_snow', [228, 240, 251], [195, 216, 238], [24, 36, 58], [90, 120, 170, 0.16], [255, 255, 255, 0.95], { pixel: true, frame: 'brick', float: 'snow' }),
  B(15, '도트 던전', 'pixel', 'px_dungeon', [74, 71, 87], [64, 61, 77], [10, 9, 14], [0, 0, 0, 0.2], [180, 176, 200, 0.7], { pixel: true, frame: 'brick', grade: 0.6 }),
  // 전투장
  B(21, '콜로세움', 'arena', 'sand', [224, 186, 124], [198, 152, 92], [32, 22, 18], [90, 55, 20, 0.14], [230, 210, 170, 0.9], { frame: 'colosseum', wallHeight: 1, grade: 0.9 }),
  B(22, '돌 전투장', 'arena', 'stone', [118, 122, 138], [92, 96, 112], [14, 14, 22], [0, 0, 0, 0.2], [200, 205, 225, 0.8], { frame: 'pit', wallHeight: 0.8, grade: 0.85 }),
  B(23, '용암 전투장', 'arena', 'volcanic', [76, 48, 46], [46, 28, 30], [120, 30, 6], [255, 140, 60, 0.12], [255, 170, 90, 0.9], { frame: 'lava', wallHeight: 0.5, grade: 0.55, glow: 'lavacracks' }),
  // 이벤트
  B(31, '네온 시티', 'event', 'neon', [30, 12, 56], [14, 6, 38], [8, 3, 22], [255, 60, 200, 0.18], [60, 255, 240, 0.9], { grade: 0.3 }),
  B(32, '우주', 'event', 'space', [10, 12, 34], [6, 6, 22], [2, 2, 10], [150, 160, 255, 0.08], [200, 210, 255, 0.5], { float: 'meteors', starsOut: true, grade: 0.35 }),
];

export const BG_BY_ID = new Map(BACKGROUNDS.map((b) => [b.id, b]));
export const BG_GROUP_NAMES: Record<Bg['group'], string> = { nature: '자연 풍경', pixel: '도트(픽셀) 풍경', arena: '전투장', event: '이벤트' };

/** 번호가 0이거나 목록에 없으면 원래 아레나 */
export const bgOf = (id: number): Bg | null => BG_BY_ID.get(Math.round(id)) ?? null;

/** 원래 아레나의 색(조명만 켜졌을 때 이 색 위에 얹는다) */
export const DEFAULT_LOOK = { floor: [31, 42, 55] as RGB, outside: [11, 15, 23] as RGB, grid: [220, 230, 255, 0.15] as RGBA, wall: [255, 255, 255, 0.6] as RGBA };

/** 아레나 배경 테마(4.38)가 함께 쓰는 색 형식과 작은 도구. 배경 목록은 backgrounds.ts, 조명은 light.ts. */
export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

/** 화면에 떠다니는 입자 */
export type Float = 'none' | 'petals' | 'leaves' | 'snow' | 'bubbles' | 'meteors';

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rgb = (c: number[]) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
export const rgba = (c: number[], alpha = c[3] ?? 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;

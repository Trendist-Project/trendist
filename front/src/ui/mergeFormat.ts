import type { MergedPart } from '../api/types';
import { fmtNumber } from '../i18n';

/** ★ 표시(4.44): 1성(활성 일반 키워드)은 ★, 2~3성은 ★★, 4성 이상은 ★4 */
export function starLabel(stars: number): string {
  if (stars <= 1) return '★';
  return stars >= 4 ? `★${stars}` : '★'.repeat(stars);
}

/** "맥주 31 + 치킨 36" 처럼 구성 원본과 점수를 이은 글자 */
export function partsSum(parts: Pick<MergedPart, 'text' | 'trendValue'>[]): string {
  return parts.map((p) => `${p.text} ${fmtNumber(p.trendValue)}`).join(' + ');
}

/** 보관함 카드 등급 기준(4.42): 일반 키워드 1개의 최고 점수 70(= 50 + 20자 × 1)을 노멀의 끝으로, 그 위는 2·4·8·16배. 서버가 설정에 맞춰 계산한 값(/api/keywords/grades)을 받으면 그 값을 쓴다 */
export const DEFAULT_GRADE_MINS = [71, 140, 280, 560, 1120];
/** 점수 → 등급 번호(0 노멀, 1 레어, 2 에픽, 3 유니크, 4 레전드리, 5 신화) */
export const tierOf = (score: number, mins: number[]): number => { let tier = 0; mins.forEach((m, i) => { if (score >= m) tier = i + 1; }); return tier; };

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

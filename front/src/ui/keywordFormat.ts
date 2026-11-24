import { getLang } from '../country';
import { t } from '../i18n';

/** 키워드 상태 배지와 남은 시간 표기. 검색 카드, 보관함, 키워드 상세 창이 같이 쓴다. */
/** 서버가 주는 상태 값은 한국어(활성·비활성·금지) 그대로 키로 쓰고, 보이는 글자만 언어에 맞춘다 */
export const STATE_BADGE: Record<string, string> = { 활성: t('common.stateActive'), 비활성: t('common.stateInactive'), 금지: t('common.stateBanned') };

/** 날짜·시각 형식의 로캘(언어에 맞춘다) */
export const intlLocale = () => (getLang() === 'ko' ? 'ko-KR' : 'en-US');

export function remaining(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t('common.expiringSoon');
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? t('common.remainingHM', { h, m }) : t('common.remainingM', { m });
}

/** "3분 전", "2시간 전", 하루가 넘으면 날짜. */
export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t('common.justNow');
  if (s < 3600) return t('common.minutesAgo', { n: Math.floor(s / 60) });
  if (s < 86400) return t('common.hoursAgo', { n: Math.floor(s / 3600) });
  return new Intl.DateTimeFormat(intlLocale(), { month: 'short', day: 'numeric', timeZone: getLang() === 'ko' ? 'Asia/Seoul' : undefined }).format(new Date(iso));
}

/** 보관함 카드의 남은 시간: 두 자리 숫자와 한 글자 단위(예: 23h, 32m). 60분 미만은 분, 100시간 미만은 시간, 그 이상은 일 */
export function shortLeft(iso: string, now = Date.now()): { n: string; unit: 'm' | 'h' | 'd' } {
  const pad = (v: number) => String(Math.min(99, Math.max(0, v))).padStart(2, '0');
  const mins = Math.ceil((new Date(iso).getTime() - now) / 60000);
  if (mins < 60) return { n: pad(mins), unit: 'm' };
  const hours = Math.floor(mins / 60);
  if (hours < 100) return { n: pad(hours), unit: 'h' };
  return { n: pad(Math.floor(hours / 24)), unit: 'd' };
}

import { useEffect, useState } from 'react';
import { t } from '../i18n';

/** 방 전체의 싸움 소식 한 줄(4.41). mine: 내가 이긴 쪽, victim: 내가 진 쪽 */
export interface FeedLine { id: number; kind: 'steal' | 'kill'; by: string; target: string; mine: boolean; victim: boolean; streak: number; at: number }

export const FEED_MS = 7000;
const MAX_LINES = 5;

/** 새 줄을 더하고 오래된 줄을 뗀다 */
export function pushFeed(lines: FeedLine[], line: FeedLine): FeedLine[] {
  const now = line.at;
  return [...lines.filter((l) => now - l.at < FEED_MS), line].slice(-MAX_LINES);
}

/**
 * 킬 피드(4.41): 화면 구석에 "A가 B에게서 키워드를 빼앗음 / B를 쓰러뜨림"이 최근 5줄까지 쌓이고 7초 뒤 사라진다.
 * 내가 이기거나 진 줄은 색으로 알아보게 하고, 같은 사람이 10초 안에 연달아 쓰러뜨리면 ×2, ×3 …이 붙는다. 키워드 이름은 보여 주지 않는다(3.3).
 */
export function KillFeed({ lines }: { lines: FeedLine[] }) {
  const [, tick] = useState(0);
  useEffect(() => { if (lines.length === 0) return; const id = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(id); }, [lines.length]);
  const now = performance.now(), live = lines.filter((l) => now - l.at < FEED_MS);
  if (live.length === 0) return null;
  return (
    <ul className="kill-feed" aria-live="off">
      {live.map((l) => (
        <li key={l.id} className={`${l.kind}${l.mine ? ' mine' : ''}${l.victim ? ' victim' : ''}`}>
          <span aria-hidden="true">{l.kind === 'kill' ? '💀' : '🎯'}</span>
          <b className="kf-by">{l.by}</b>
          <span className="kf-verb">{t(l.kind === 'kill' ? 'gamescreen.feedKill' : 'gamescreen.feedSteal')}</span>
          <b className="kf-target">{l.target}</b>
          {l.streak >= 2 && <em className="kf-streak">×{l.streak}</em>}
        </li>
      ))}
    </ul>
  );
}

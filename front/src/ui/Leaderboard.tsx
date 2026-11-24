import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { getLeaderboard, setLeaderboard, useLeaderboard } from './leaderboardStore';
import { fmtNumber, t } from '../i18n';

const TOP = 10;          // 서버가 주는 순위 수(최대)
const MAX_LINES = 11;    // 저장하는 줄 수의 상한(TOP 10 + 내 순위 한 줄)
const MIN_LINES = 3;     // 최소 3줄(내 순위 포함): 내가 1등이 아니어도 내 순위가 항상 보이게
const ROW_PX = 22;       // 한 줄 높이(끌어서 줄 수를 정할 때의 단위)
const LINES_KEY = 'trendist.leaderboardLines';
const loadLines = () => {
  try { const n = Number(localStorage.getItem(LINES_KEY)); return Number.isInteger(n) && n >= MIN_LINES && n <= MAX_LINES ? n : MAX_LINES; } catch { return MAX_LINES; }
};

interface Props { myPlayerId: number }

/**
 * 리더보드(4.14): 지금 이 나라 방에 접속한 사람의 현재 유행도 순위(서버가 소켓으로 2초마다 보낸다). 서버는 TOP 10을 주고, 화면 영역(줄 수 N)은 아래 손잡이를 끌어 사람마다 줄이거나 늘린다.
 * - 최대는 내가 10위 안이면 10줄, 11위 아래면 11줄(10위 + 내 순위 한 줄)이고, 최소는 3줄이다(내 순위 포함, 1등이 아니어도 내 순위가 항상 보이게).
 * - 영역 N줄 안에는 항상 내 순위가 있다: 내가 N위 안이면 1~N위(내 줄 강조, 아래에 또 보이지 않음), 아니면 1~(N-1)위 + 맨 아래 내 순위 한 줄.
 *   예) N=4에 내가 15위 → 1~3위 + 내 순위, N=3에 내가 3위 → 1~3위.
 */
export function Leaderboard({ myPlayerId }: Props) {
  const board = useLeaderboard(); // 서버가 소켓으로 2초마다 보내 주는 값(leaderboard 메시지)
  const ranking = board?.top ?? null;
  const mine = board?.me ?? null;
  const [lines, setLines] = useState(loadLines);
  const drag = useRef<{ y: number; n: number } | null>(null);

  // 소켓 값이 처음 오기까지(최대 2초)만 한 번 조회해 빈 칸을 채운다. 그 뒤로는 조회하지 않는다
  useEffect(() => {
    if (getLeaderboard() !== null) return;
    let alive = true;
    Promise.all([api.rankings(), api.myRank().catch(() => null)])
      .then(([top, me]) => { if (alive && getLeaderboard() === null) setLeaderboard({ top, me }); })
      .catch(() => { /* 소켓 값이 올 때까지 비어 있다 */ });
    return () => { alive = false; };
  }, []);

  const save = (n: number) => { try { localStorage.setItem(LINES_KEY, String(n)); } catch { /* 저장 못 해도 된다 */ } };
  const onDown = (e: React.PointerEvent) => { drag.current = { y: e.clientY, n }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { if (drag.current) setLines(clamp(drag.current.n + Math.round((e.clientY - drag.current.y) / ROW_PX))); };
  const onUp = () => { if (drag.current) { drag.current = null; save(n); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const next = clamp(n + (e.key === 'ArrowDown' ? 1 : -1));
    setLines(next); save(next);
  };

  // 줄 수의 한도: 10위 안이면 최대 10줄, 11위 아래면 11줄(10위 + 내 순위). 접속자가 적으면 있는 만큼. 최소 2줄
  const all = ranking ?? [];
  const mineOutside = mine !== null && mine.rank > Math.min(TOP, all.length);
  const available = all.length + (mineOutside ? 1 : 0);
  const maxLines = Math.max(1, Math.min(TOP + (mineOutside ? 1 : 0), available));
  const clamp = (n: number) => Math.max(Math.min(MIN_LINES, maxLines), Math.min(maxLines, n));
  const n = clamp(lines);
  // 영역 n줄 안에 내 순위가 항상 있다
  const mineInside = mine !== null && mine.rank <= Math.min(n, all.length);
  const showMine = mine !== null && !mineInside;
  const shown = all.slice(0, showMine ? Math.max(0, n - 1) : n);

  return (
    <section className="leaderboard" aria-label={t('rank.label')}>
      <h3>{t('rank.title')} <span className="muted small">TOP 10</span></h3>
      {ranking === null ? <p className="muted small">{t('rank.loading')}</p>
        : ranking.length === 0 ? <p className="muted small">{t('rank.empty')}</p>
        : (
          <ol className="list ranking">
            {shown.map((r) => (
              <li key={r.playerId} className={r.playerId === myPlayerId ? 'me' : undefined}>
                <span className="rank">{r.rank}</span> <strong>{r.nickname}</strong>
                <span className="score">{fmtNumber(Number(r.score))}</span>
              </li>
            ))}
            {showMine && (
              <li className="me my-rank" aria-label={t('rank.mine', { n: mine.rank })}>
                <span className="rank">{mine.rank}</span> <strong>{mine.nickname}</strong>
                <span className="score">{fmtNumber(Number(mine.score))}</span>
              </li>
            )}
          </ol>
        )}
      <div className="lb-resize" role="separator" aria-orientation="horizontal" aria-label={t('rank.resizeAria')} aria-valuemin={Math.min(MIN_LINES, maxLines)} aria-valuemax={maxLines} aria-valuenow={n}
           tabIndex={0} title={t('rank.resizeTitle')} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}><i /></div>
    </section>
  );
}

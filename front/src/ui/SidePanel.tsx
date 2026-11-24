import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, ApiFailure } from '../api/client';
import type { KeywordCard, MyKeyword, PlayerSummary } from '../api/types';
import { remaining, STATE_BADGE } from './keywordFormat';
import { fmtNumber, t } from '../i18n';
import { getLang } from '../country';
import { PlayerSearch } from './PlayerSearch';
import { useLayer } from './layers';

type Tab = 'search' | 'mine' | 'players';

interface Props {
  onPlused(gained: number, player: PlayerSummary): void;
  onError(message: string): void;
  refreshKey: number;
  /** 키워드 이름을 누르면 상세 창(4.12)을 연다. */
  onOpenKeyword(keywordId: number): void;
  /** 플레이어 상세의 [공유]: 채팅에 그 플레이어를 보낸다 */
  onSharePlayer?(playerId: number, nickname: string): void;
  /** 채팅의 #키워드를 누르면 검색창에 넣고 검색한다(4.13). */
  searchRequest: { text: string; key: number } | null;
  /** PC: 이 영역을 숨긴다(탭 줄 오른쪽 ▶ 버튼). 숨기면 아레나 오른쪽 가장자리의 탭으로 다시 연다 */
  onHide?(): void;
  /** 모바일 메뉴에서 [검색]·[보관함]을 눌렀다: 그 탭으로 시트를 연다(모바일은 시트가 평소에는 숨어 있다) */
  openRequest?: { tab: Tab; key: number } | null;
}

/** 보관함 정렬 기준. 기본은 남은 시간이 많은 것부터(곧 사라질 키워드가 아래로). */
type SortKey = 'recent' | 'text' | 'state' | 'trend' | 'remaining';
type SortDir = 'asc' | 'desc';
// 칩은 이 순서로 보인다. 기본 정렬인 남은 시간을 맨 앞에 둔다
const SORT_LABEL: Record<SortKey, string> = { remaining: t('side.sortRemaining'), recent: t('side.sortRecent'), text: t('side.sortText'), state: t('side.sortState'), trend: t('side.sortTrend') };
/** 기준을 고르면 먼저 쓰는 방향: 최신·트렌드·남은 시간은 큰 것부터, 키워드는 가나다, 상태는 🔥부터 */
const DEFAULT_DIR: Record<SortKey, SortDir> = { recent: 'desc', text: 'asc', state: 'asc', trend: 'desc', remaining: 'desc' };
const STATE_ORDER: Record<string, number> = { 활성: 0, 비활성: 1, 금지: 2 };
// 고른 정렬을 브라우저에 기억하는 키
const SORT_STORE = 'trendist.mineSort.v2';

function loadSort(): { key: SortKey; dir: SortDir } {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_STORE) ?? 'null');
    if (v && v.key in SORT_LABEL && (v.dir === 'asc' || v.dir === 'desc')) return v;
  } catch { /* 기본값 */ }
  return { key: 'remaining', dir: 'desc' };
}

function sortMine(list: MyKeyword[], key: SortKey, dir: SortDir) {
  const sign = dir === 'asc' ? 1 : -1;
  const time = (iso: string) => new Date(iso).getTime();
  const compare = (a: MyKeyword, b: MyKeyword) => {
    switch (key) {
      case 'text': return a.text.localeCompare(b.text, getLang());
      case 'state': return (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9);
      case 'trend': return Number(a.trendValue) - Number(b.trendValue);
      case 'remaining': return time(a.expiresAt) - time(b.expiresAt);
      default: return time(a.plusedAt) - time(b.plusedAt);
    }
  };
  // 같은 값이면 최신순으로
  return [...list].sort((a, b) => sign * compare(a, b) || time(b.plusedAt) - time(a.plusedAt));
}


export function SidePanel({ onPlused, onError, refreshKey, onOpenKeyword, onSharePlayer, searchRequest, openRequest, onHide }: Props) {
  const layer = useLayer('side');
  const [tab, setTab] = useState<Tab>('search');
  const [q, setQ] = useState('');
  const [card, setCard] = useState<KeywordCard | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mine, setMine] = useState<MyKeyword[]>([]);
  const [, minuteTick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => minuteTick((n) => n + 1), 30_000); return () => window.clearInterval(id); }, []); // 남은 시간 게이지를 30초마다 다시 계산(4.42)
  const [busy, setBusy] = useState(false);
  // 모바일 하단 시트: 접혀 있으면 탭 줄만 보인다. 탭을 누르면 펼치고, 펼친 탭을 다시 누르면 접는다(데스크톱은 늘 펼침)
  const [expanded, setExpanded] = useState(false);
  const sideRef = useRef<HTMLElement>(null);
  const [sort, setSort] = useState(loadSort);
  const sortedMine = useMemo(() => sortMine(mine, sort.key, sort.dir), [mine, sort]);

  useEffect(() => {
    try { localStorage.setItem(SORT_STORE, JSON.stringify(sort)); } catch { /* 이 브라우저에만 기억 */ }
  }, [sort]);

  async function loadMine() { try { setMine(await api.myKeywords()); } catch { /* 다음에 다시 */ } }

  useEffect(() => {
    if (!openRequest) return;
    setTab(openRequest.tab);
    setExpanded(true);
    layer.front();
  }, [openRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // 모바일·가로 모드 폰의 시트: 열려 있을 때 시트 밖을 누르면(아레나·조이스틱 포함) 저절로 닫는다. 위쪽의 [🔍][📦] 버튼은 탭만 바꾸므로 제외한다
  useEffect(() => {
    if (!expanded) return;
    const compact = window.matchMedia('(max-width: 760px), (orientation: landscape) and (max-height: 520px) and (pointer: coarse)');
    const onDown = (e: PointerEvent) => {
      if (!compact.matches) return; // PC의 오른쪽 패널은 늘 열려 있다
      const el = e.target instanceof Element ? e.target : null;
      // 시트 안, 위쪽 [🔍][📦] 버튼, 그리고 창(키워드 상세·신고 등)을 누르는 것은 밖으로 치지 않는다: 시트에서 연 키워드 상세를 닫으면 시트는 그대로 남아 있어야 한다
      if (!el || sideRef.current?.contains(el) || el.closest('.side-toggle, .modal-backdrop, .title-alert')) return;
      setExpanded(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [expanded]);

  // 채팅의 #키워드: 검색 탭으로 옮겨 그 단어로 검색한다
  useEffect(() => {
    if (!searchRequest) return;
    setTab('search');
    setExpanded(true);
    setQ(searchRequest.text);
    runSearch(searchRequest.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRequest]);

  // 보관함 개수를 탭 글자 옆에 늘 보이려고, 어느 탭이든 불러온다(처음·바뀔 때마다, 그리고 1분마다: 24시간이 지나 사라지는 키워드가 있다)
  useEffect(() => {
    loadMine();
    const id = window.setInterval(loadMine, 60_000);
    return () => window.clearInterval(id);
  }, [tab, refreshKey]);

  async function search(e: FormEvent) {
    e.preventDefault();
    await runSearch(q);
  }

  async function runSearch(text: string) {
    if (!text.trim()) return;
    setBusy(true); setNotice(null); setCard(null);
    try {
      const r = await api.search(text);
      if (r.status === 'BANNED') setNotice(t('side.banned'));
      else setCard(r.keyword);
    } catch (err) {
      setNotice(err instanceof ApiFailure ? err.message : t('side.searchFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function plus() {
    if (!card) return;
    setBusy(true);
    try {
      const r = await api.plus(card.text);
      setCard(r.keyword);
      onPlused(r.gained, r.player);
    } catch (err) {
      onError(err instanceof ApiFailure ? err.message : t('side.plusFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside ref={sideRef} className={expanded ? 'side expanded' : 'side'} {...layer.props}>
      <nav className="tabs" role="tablist">
        {([['search', t('side.tabSearch')], ['mine', `${t('side.tabMine')} (${mine.length})`], ['players', t('player.searchTab')]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''}
                  onClick={() => { if (tab === k && expanded) setExpanded(false); else { setTab(k); setExpanded(true); } }}>{label}</button>
        ))}
        {onHide && <button className="side-hide" onClick={onHide} aria-label={t('side.hidePanel')} title={t('side.hidePanel')}>▶</button>}
        <button className="sheet-toggle" onClick={() => setExpanded(false)} aria-expanded={expanded}
                aria-label={t('side.collapsePanel')} title={t('side.collapsePanel')}>✕</button>
      </nav>

      {tab === 'search' && (
        <div className="tab-body">
          <form onSubmit={search} className="search-row">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('side.placeholder')} maxLength={20}
                   aria-label={t('side.searchAria')} autoComplete="off" />
            <button className="primary" disabled={busy}>{t('side.searchBtn')}</button>
          </form>
          {notice && <p className="muted">{notice}</p>}
          {card && (
            <div className="card">
              <div className="card-head">
                {card.id !== null
                  ? <button className="kw kw-link" onClick={() => onOpenKeyword(card.id!)} title={t('side.detail')}>{card.text} <span aria-hidden="true">›</span></button>
                  : <strong className="kw">{card.text}</strong>}
                <span className="badge">{STATE_BADGE[card.state] ?? card.state}</span>
              </div>
              <p>{t('side.points', { n: card.trendValue })} · 👥 {t('side.holders', { n: fmtNumber(card.holderCount) })}</p>
              <div className="card-foot">
                {card.plusedByMe && card.myExpiresAt && <span className="muted small">{remaining(card.myExpiresAt)}</span>}
                <button className="primary" onClick={plus} disabled={busy || card.plusedByMe}
                        aria-label={card.plusedByMe ? t('side.alreadyOwned') : t('side.plusAria', { kw: card.text })}>
                  {card.plusedByMe ? t('side.owned') : t('side.plus')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'players' && <PlayerSearch onOpenKeyword={onOpenKeyword} onShare={onSharePlayer} />}

      {tab === 'mine' && (
        <div className="tab-body">
          {mine.length === 0 ? <p className="muted">{t('side.noneYet')}</p> : (<>
            <div className="sort-bar">
              {/* 기준을 누르면 그 기준으로, 이미 고른 기준을 다시 누르면 방향을 바꾼다 */}
              <div className="sort-chips" role="group" aria-label={t('side.sortGroup')}>
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => {
                  const active = sort.key === k;
                  return (
                    <button key={k} className={active ? 'sort-chip active' : 'sort-chip'} aria-pressed={active}
                            title={active ? t('side.sortFlip') : undefined}
                            aria-label={active ? t('side.sortActiveAria', { label: SORT_LABEL[k], dir: sort.dir === 'asc' ? t('side.asc') : t('side.desc') }) : t('side.sortByAria', { label: SORT_LABEL[k] })}
                            onClick={() => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: DEFAULT_DIR[k] }))}>
                      {SORT_LABEL[k]}
                      {active && <span className="sort-arrow" aria-hidden="true">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <ul className="list">
              {sortedMine.map((k) => (
                <MineCard key={k.keywordId} k={k} onOpen={() => onOpenKeyword(k.keywordId)} />
              ))}
            </ul>
          </>)}
        </div>
      )}

    </aside>
  );
}

/** 점수(트렌드 값, 가진 사람이 많을수록 오른다)에 따른 카드 등급: 0 기본 · 1 주목(15~) · 2 인기(30~) · 3 대세(50~) */
const tierOf = (score: number) => (score >= 50 ? 3 : score >= 30 ? 2 : score >= 15 ? 1 : 0);

/**
 * 보관함 키워드 카드(4.42): 이름·상태 배지 아래에 남은 시간 게이지가 있다. 게이지는 처음 +한 시간(또는 갱신한 시간)부터 사라질 때까지 줄어들고,
 * 절반 아래는 주황, 1시간 아래는 빨강으로 깜빡인다. 남은 시간 글자도 있어 색에만 기대지 않는다.
 * 카드의 모양은 키워드 **점수**로 달라진다(점수는 가진 사람이 많을수록 오른다): 왼쪽 띠와 점수 칩이 15점부터 초록, 30점부터 주황, 50점부터 금빛 그라데이션이 된다.
 * 상태(활성·비활성)는 배지 하나로만 보여 준다(불꽃 아이콘을 더 붙이지 않는다).
 */
function MineCard({ k, onOpen }: { k: MyKeyword; onOpen: () => void }) {
  const left = new Date(k.expiresAt).getTime() - Date.now();
  const total = Math.max(new Date(k.expiresAt).getTime() - new Date(k.plusedAt).getTime(), left, 1);
  const ratio = Math.max(0, Math.min(1, left / total));
  const tone = left < 3_600_000 ? 'urgent' : ratio < 0.5 ? 'mid' : 'ok';
  const tier = tierOf(k.trendValue);
  return (
    <li className={`mine-item mine-card ${tone} tier${tier}`}>
      <button className="mine-open" onClick={onOpen} aria-label={t('side.openAria', { kw: k.text })}>
        <div className="mine-card-head">
          <strong>{k.text}</strong> <span className="badge">{STATE_BADGE[k.state] ?? k.state}</span>
          <span className="mine-score" title={tier > 0 ? t(`side.tier${tier}`) : undefined}>{t('side.points', { n: k.trendValue })}</span>
        </div>
        <div className="kw-time"><span className={left < 3_600_000 ? 'warn' : ''}>{remaining(k.expiresAt)}</span></div>
        <div className="kw-gauge" role="presentation"><i style={{ width: `${(ratio * 100).toFixed(1)}%` }} /></div>
        <span className="mine-chevron" aria-hidden="true">›</span>
      </button>
    </li>
  );
}

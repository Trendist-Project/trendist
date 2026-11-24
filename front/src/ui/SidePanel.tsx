import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiFailure } from '../api/client';
import { applySideVars, clampSideH, clampSideW, loadSideHeight, loadSideWidth, saveSideSize, SIDE_H_MIN, SIDE_W_MIN, sideHMax, sideWMax } from './gamePrefs';
import type { KeywordCard, MergeResult, MyKeyword, PlayerSummary } from '../api/types';
import { remaining, shortLeft, STATE_BADGE } from './keywordFormat';
import { fmtNumber, t } from '../i18n';
import { getLang } from '../country';
import { PlayerSearch } from './PlayerSearch';
import { starLabel } from './mergeFormat';
import { StarRow } from './StarRow';
import { ScrollRow } from './ScrollRow';
import { useLayer } from './layers';

type Tab = 'search' | 'mine' | 'players';

interface Props {
  onPlused(gained: number, player: PlayerSummary): void;
  /** 키워드 합성(4.44)이 끝났다: 점수 갱신·소리·알림은 부른 쪽이 맡고, 보관함 갱신과 카드 연출은 이 패널이 한다 */
  onMerged(result: MergeResult): void;
  onError(message: string): void;
  refreshKey: number;
  /** 키워드 이름을 누르면 상세 창(4.12)을 연다. merged면 합성 키워드 전용 상세 창(4.44) */
  onOpenKeyword(keywordId: number, merged?: boolean): void;
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


const SHEET_MQ = '(max-width: 760px), (orientation: landscape) and (max-height: 520px) and (pointer: coarse)';
const DRAWER_MQ = '(orientation: landscape) and (max-height: 520px) and (pointer: coarse)';
const matches = (q: string) => { try { return window.matchMedia(q).matches; } catch { return false; } };

/** 패널 크기 조절 핸들. PC·가로 폰 서랍은 왼쪽 모서리(너비), 세로 모바일 시트는 위쪽 모서리(높이). 드래그가 끝날 때 한 번 저장한다 */
function ResizeHandle({ sideRef }: { sideRef: React.RefObject<HTMLElement | null> }) {
  const [drag, setDrag] = useState(false);
  const start = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const mode = () => (matches(SHEET_MQ) && !matches(DRAWER_MQ) ? 'h' : 'w') as 'h' | 'w';
  const cur = () => { const r = sideRef.current?.getBoundingClientRect(); return { w: r?.width ?? 340, h: r?.height ?? 260 }; };
  const [orient, setOrient] = useState<'h' | 'w'>(mode);
  useEffect(() => {
    const upd = () => setOrient(mode());
    window.addEventListener('resize', upd); return () => window.removeEventListener('resize', upd);
  }, []);
  const apply = (m: 'h' | 'w', v: number) => { if (m === 'w') applySideVars(v, loadSideHeight()); else applySideVars(loadSideWidth(), v); };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, ...cur() }; setDrag(true); document.body.classList.add('side-resizing');
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current; if (!s) return;
    if (orient === 'w') apply('w', clampSideW(s.w + (s.x - e.clientX))); else apply('h', clampSideH(s.h + (s.y - e.clientY)));
  };
  const onUp = () => {
    if (!start.current) return;
    start.current = null; setDrag(false); document.body.classList.remove('side-resizing');
    const c = cur(); if (orient === 'w') saveSideSize(c.w, undefined); else saveSideSize(undefined, c.h);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const grow = orient === 'w' ? 'ArrowLeft' : 'ArrowUp', shrink = orient === 'w' ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    const c = cur(); const d = e.key === grow ? 20 : -20;
    if (orient === 'w') saveSideSize(c.w + d, undefined); else saveSideSize(undefined, c.h + d);
  };
  const reset = () => { if (orient === 'w') saveSideSize(null, undefined); else saveSideSize(undefined, null); };
  useEffect(() => () => document.body.classList.remove('side-resizing'), []);
  const now = Math.round(orient === 'w' ? cur().w : cur().h);
  return <div className={drag ? 'side-resize dragging' : 'side-resize'} role="separator" tabIndex={0} aria-orientation={orient === 'w' ? 'vertical' : 'horizontal'}
              aria-label={t(orient === 'w' ? 'side.resizeW' : 'side.resizeH')} title={t(orient === 'w' ? 'side.resizeW' : 'side.resizeH')}
              aria-valuenow={now} aria-valuemin={orient === 'w' ? SIDE_W_MIN : SIDE_H_MIN} aria-valuemax={orient === 'w' ? sideWMax() : sideHMax()}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp}
              onKeyDown={onKey} onDoubleClick={reset} />;
}

export function SidePanel({ onPlused, onMerged, onError, refreshKey, onOpenKeyword, onSharePlayer, searchRequest, openRequest, onHide }: Props) {
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
  const [mins, setMins] = useState<number[]>(DEFAULT_GRADE_MINS); // 카드 등급 기준(4.42)
  useEffect(() => { api.keywordGrades().then((g) => { if (Array.isArray(g.mins) && g.mins.length === 5) setMins(g.mins); }).catch(() => { /* 기본 기준 */ }); }, []);
  const sortedMine = useMemo(() => sortMine(mine, sort.key, sort.dir), [mine, sort]);

  // ---- 키워드 합성(4.44): 드래그(마우스)와 [🔗] 탭, 확정 전 미리보기, 합쳐지는 연출
  const [mergeFrom, setMergeFrom] = useState<number | null>(null); // 합성 모드: 이 카드와 합칠 짝을 고른다
  const merging = useRef(false); // 합성 요청 중(연타 방지)
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; over: number | null } | null>(null);
  const [probe, setProbe] = useState<number | null>(null); // 마우스·키보드가 가리키는 후보: 서버에 합칠 수 있는지 한 번 묻는다
  const [verdict, setVerdict] = useState<Record<string, string>>({}); // 서버 판정 캐시: '' 은 가능, 그 밖은 불가 사유
  const [fresh, setFresh] = useState<{ id: number; bonus: boolean } | null>(null); // 방금 생긴 합성 카드
  const suppressClick = useRef(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);
  const mineById = useMemo(() => new Map(mine.map((k) => [k.keywordId, k])), [mine]);
  const source = drag?.id ?? mergeFrom;
  const pairKey = (x: number, y: number) => (x < y ? `${x}:${y}` : `${y}:${x}`);

  /** 서버에 묻지 않고 아는 불가 사유(💤 비활성, 구성 겹침). 글자 수 초과 등은 서버 판정을 따른다 */
  const localReason = useCallback((a: MyKeyword, b: MyKeyword): string | null => {
    if (a.state !== '활성' || b.state !== '활성') return t('merge.reasonInactive');
    const ids = new Set(a.merged ? a.parts.map((p) => p.keywordId) : [a.keywordId]);
    if ((b.merged ? b.parts.map((p) => p.keywordId) : [b.keywordId]).some((id) => ids.has(id))) return t('merge.reasonOverlap');
    return null;
  }, []);
  const reasonFor = (id: number): string | null => {
    const a = source != null ? mineById.get(source) : undefined, b = mineById.get(id);
    if (!a || !b || a === b) return null;
    return localReason(a, b) ?? (verdict[pairKey(a.keywordId, b.keywordId)] || null);
  };

  const endMerge = useCallback(() => { setMergeFrom(null); setProbe(null); setVerdict({}); }, []);
  /** 두 카드를 확인 창 없이 바로 합친다. 합칠 수 없으면(서버 판정 포함) 이유를 알림으로 보여 준다 */
  const openPair = useCallback((aId: number, bId: number) => {
    const a = mineById.get(aId), b = mineById.get(bId);
    if (!a || !b || a === b || merging.current) return;
    endMerge();
    const why = localReason(a, b);
    if (why) { onError(why); return; }
    merging.current = true;
    api.merge(a.keywordId, b.keywordId)
      .then((r) => handleMerged(r, a, b))
      .catch((e) => onError(e instanceof ApiFailure ? e.message : t('merge.failed')))
      .finally(() => { merging.current = false; });
  }, [mineById, endMerge, localReason, onError]); // eslint-disable-line react-hooks/exhaustive-deps

  // 후보를 가리키면(호버·드래그 위·키보드 포커스) 서버 미리보기로 합칠 수 있는지 한 번만 묻는다. 보관함이 많아도 가리킨 카드만 묻는다
  useEffect(() => {
    if (source == null || probe == null || probe === source) return;
    const a = mineById.get(source), b = mineById.get(probe);
    if (!a || !b || localReason(a, b) || pairKey(source, probe) in verdict) return;
    const key = pairKey(source, probe);
    const id = window.setTimeout(() => {
      api.mergePreview(source, probe).then((p) => setVerdict((v) => ({ ...v, [key]: p.ok ? '' : (p.reason ?? t('merge.failed')) }))).catch(() => { /* 확정 때 알려 준다 */ });
    }, 200);
    return () => window.clearTimeout(id);
  }, [source, probe, mineById, verdict, localReason]);

  // 합성 모드: Esc나 보관함 카드 밖을 누르면 끝낸다
  useEffect(() => {
    if (mergeFrom === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') endMerge(); };
    const onDown = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el?.closest('.mine-card')) endMerge();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown, true); };
  }, [mergeFrom, endMerge]);

  /**
   * 끌어서 합치기: [🔗] 버튼은 마우스·터치 모두, 카드 본문은 마우스로만(터치는 스크롤과 겹친다) 다른 카드 위로 끌어다 놓으면 바로 합쳐진다.
   * fromLink면 [🔗] 버튼에서 시작한 것이다. 끌지 않고 놓으면 그냥 눌린 것이라 버튼의 클릭(합성 모드)으로 이어진다.
   */
  function startDrag(e: ReactPointerEvent, k: MyKeyword, fromLink = false) {
    if ((!fromLink && e.pointerType !== 'mouse') || e.button !== 0 || k.state !== '활성') return;
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    const idAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)?.closest('[data-mine-id]');
      return el ? Number(el.getAttribute('data-mine-id')) : null;
    };
    const stop = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', onKey);
      setDrag(null); setProbe(null);
    };
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        started = true; setMergeFrom(null);
      }
      const over = idAt(ev.clientX, ev.clientY);
      setDrag({ id: k.keywordId, x: ev.clientX, y: ev.clientY, over: over === k.keywordId ? null : over });
      setProbe(over === k.keywordId ? null : over);
    };
    const up = (ev: PointerEvent) => {
      const over = started ? idAt(ev.clientX, ev.clientY) : null;
      stop();
      if (!started) return;
      suppressClick.current = true; // 끌었다 놓은 뒤 따라오는 클릭이 상세 창을 열지 않게
      timers.current.push(window.setTimeout(() => { suppressClick.current = false; }, 0));
      if (over !== null && over !== k.keywordId) openPair(k.keywordId, over);
    };
    const cancel = () => { stop(); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { stop(); suppressClick.current = true; timers.current.push(window.setTimeout(() => { suppressClick.current = false; }, 0)); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', onKey);
  }

  /** 합성이 끝났다: 기다리지 않고 바로 보관함을 새 값으로 바꾸고, 새 카드가 튀어 오른다(움직임 줄이기면 CSS가 번쩍임만 남긴다) */
  function handleMerged(r: MergeResult, a?: MyKeyword, b?: MyKeyword) {
    onMerged(r);
    {
      setMine((list) => [...list.filter((k) => k.keywordId !== a?.keywordId && k.keywordId !== b?.keywordId && k.keywordId !== r.keyword.keywordId), r.keyword]);
      setFresh({ id: r.keyword.keywordId, bonus: r.bonus });
      void loadMine();
      timers.current.push(window.setTimeout(() => {
        try { document.querySelector(`[data-mine-id="${r.keyword.keywordId}"]`)?.scrollIntoView({ block: 'nearest' }); } catch { /* 무시 */ }
      }, 50));
      timers.current.push(window.setTimeout(() => setFresh((f) => (f?.id === r.keyword.keywordId ? null : f)), 550));
    }
  }

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
      <ResizeHandle sideRef={sideRef} />
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
              <ScrollRow className="sort-chips" role="group" aria-label={t('side.sortGroup')}>
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
              </ScrollRow>
            </div>
            <ul className={source != null ? 'list merge-active' : 'list'}>
              {sortedMine.map((k) => {
                const id = k.keywordId;
                // 합성 모드에서 카드를 눌렀다: 출발 카드면 모드 끝, 로컬에서 불가가 확실하면 무시, 그 밖에는 미리보기(서버가 이유를 알려 준다)
                const pick = () => { if (mergeFrom === id) endMerge(); else if (mergeFrom !== null && !localReason(mineById.get(mergeFrom)!, k)) openPair(mergeFrom, id); };
                const role = source == null ? null : id === source ? 'source' : reasonFor(id) ? 'bad' : 'ok';
                return (
                  <MineCard key={id} k={k} mins={mins} role={role} reason={role === 'bad' ? reasonFor(id) : null}
                            over={drag?.over === id} merging={null}
                            fresh={fresh?.id === id ? (fresh.bonus ? 'bonus' : 'yes') : null}
                            onOpen={() => { if (!suppressClick.current) onOpenKeyword(id, k.merged); }}
                            onLink={() => { if (suppressClick.current) return; if (mergeFrom === null) setMergeFrom(id); else pick(); }}
                            onLinkDown={(e) => startDrag(e, k, true)}
                            mode={mergeFrom !== null}
                            onPick={pick}
                            onProbe={() => { if (source != null) setProbe(id); }}
                            onDragStart={(e) => startDrag(e, k)} />
                );
              })}
            </ul>
            <p className="muted small merge-drag-hint">{t('merge.dragHint')}</p>
          </>)}
        </div>
      )}

      {drag && createPortal(<div className="merge-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }} aria-hidden="true">{mineById.get(drag.id)?.merged ? `${starLabel(mineById.get(drag.id)!.stars)} ` : ''}{mineById.get(drag.id)?.text}</div>, document.body)}
    </aside>
  );
}

/** 점수(트렌드 값, 가진 사람이 많을수록 오른다)에 따른 카드 등급: 0 기본 · 1 주목(15~) · 2 인기(30~) · 3 대세(50~) · 4 전설(100~, 합성 키워드가 주로 닿는다). 점수에는 상한이 없다 */
/** 기본 등급 기준: 일반 키워드 1개의 최고 점수 70(= 50 + 20자 × 1)을 노멀의 끝으로, 그 위는 2·4·8·16배. 서버가 설정에 맞춰 계산한 값(/api/keywords/grades)을 받으면 그 값을 쓴다 */
const DEFAULT_GRADE_MINS = [71, 140, 280, 560, 1120];
const tierOf = (score: number, mins: number[]) => { let t = 0; mins.forEach((m, i) => { if (score >= m) t = i + 1; }); return t; };

type Fx = 'yes' | 'bonus' | null;

/**
 * 보관함 키워드 카드(4.42): 이름·상태 배지 아래에 남은 시간 게이지가 있다. 게이지는 처음 +한 시간(또는 갱신한 시간)부터 사라질 때까지 줄어들고,
 * 절반 아래는 주황, 1시간 아래는 빨강으로 깜빡인다. 남은 시간 글자도 있어 색에만 기대지 않는다.
 * 카드의 모양은 키워드 **점수**로 달라진다(점수는 가진 사람이 많을수록 오른다): 왼쪽 띠와 점수 칩이 15점부터 초록, 30점부터 주황, 50점부터 금빛, 100점부터 보랏빛 그라데이션이 된다.
 * 상태(활성·비활성)는 배지 하나로만 보여 준다(불꽃 아이콘을 더 붙이지 않는다).
 * 합성 키워드(4.44)는 이름 앞에 ★이 붙는다(4성 이상은 ★4). 이름이 구성 원본을 띄어 쓴 것이라 구성을 따로 적지 않는다. 오른쪽 [🔗]는 합성 모드를 켠다.
 * role: 합성 모드·드래그 중의 역할(source 출발 · ok 합칠 수 있음 · bad 합칠 수 없음, reason에 이유).
 */
function MineCard({ k, mins, role, reason, over, merging, fresh, mode, onOpen, onLink, onLinkDown, onPick, onProbe, onDragStart }: {
  k: MyKeyword; mins: number[]; role: 'source' | 'ok' | 'bad' | null; reason: string | null; over: boolean; merging: Fx; fresh: Fx; mode: boolean;
  onOpen(): void; onLink(): void; onLinkDown(e: ReactPointerEvent): void; onPick(): void; onProbe(): void; onDragStart(e: ReactPointerEvent): void;
}) {
  const left = new Date(k.expiresAt).getTime() - Date.now();
  const total = Math.max(new Date(k.expiresAt).getTime() - new Date(k.plusedAt).getTime(), left, 1);
  const ratio = Math.max(0, Math.min(1, left / total));
  const tone = left < 3_600_000 ? 'urgent' : ratio < 0.5 ? 'mid' : 'ok';
  const tier = tierOf(k.trendValue, mins);
  const hasStars = k.merged || k.state === '활성';
  const lf = shortLeft(k.expiresAt);
  const cls = ['mine-item', 'mine-card', tone, `tier${tier}`, k.merged && 'merged', role && `merge-${role}`, over && 'merge-over',
    merging && `merging${merging === 'bonus' ? ' bonus' : ''}`, fresh && `merge-fresh${fresh === 'bonus' ? ' bonus' : ''}`].filter(Boolean).join(' ');
  const inactive = k.state !== '활성';
  return (
    <li className={cls} data-mine-id={k.keywordId} onPointerEnter={onProbe} onFocus={onProbe} title={reason ?? undefined}>
      <button className="mine-open" onClick={mode ? onPick : onOpen} onPointerDown={onDragStart}
              aria-label={t('side.openAria', { kw: k.text })} aria-disabled={role === 'bad' || undefined}>
        <div className="mine-row1">
          {hasStars
            ? <StarRow stars={k.stars} label={t('merge.starsAria', { n: k.stars })} />  /* 별을 개수 그대로, 한 줄에 넘치면 ★×N */
            : <span className="mine-stars"><span className="badge">{STATE_BADGE[k.state] ?? k.state}</span></span>} {/* 비활성은 별 자리에 상태 태그 */}
          <span className="mine-score" title={tier > 0 ? t(`side.tier${tier}`) : undefined}>{t('side.points', { n: fmtNumber(k.trendValue) })}</span>
        </div>
        <div className="mine-name"><strong title={k.text}>{k.text}</strong></div>
        <div className="mine-row3">
          <div className="kw-gauge" role="presentation"><i style={{ width: `${(ratio * 100).toFixed(1)}%` }} /></div>
          <span className={left < 3_600_000 ? 'kw-left warn' : 'kw-left'}>{lf.n}{lf.unit} {t('side.leftSuffix')}</span>
        </div>
      </button>
      <button type="button" className={role === 'source' && mode ? 'merge-link cancel' : 'merge-link'} disabled={inactive && !mode}
              onClick={onLink} onPointerDown={onLinkDown}
              aria-pressed={role === 'source'} aria-label={role === 'source' && mode ? t('merge.modeExit') : t('merge.linkAria', { kw: k.text })}
              title={inactive ? t('merge.reasonInactive') : role === 'source' && mode ? t('merge.modeExit') : t('merge.linkTitle')}><span aria-hidden="true">{t('merge.linkBtn')}</span></button>
      {reason && ( /* 합칠 수 없는 카드: 카드 높이가 늘어나지 않게 카드 위에 회색 금지 표시와 이유를 겹쳐 띄운다 */
        <div className="merge-block" role="note"><span className="merge-block-icon" aria-hidden="true">🚫</span><span className="merge-block-text">{reason}</span></div>
      )}
    </li>
  );
}

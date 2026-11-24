import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiFailure } from '../api/client';
import { applySideVars, clampSideH, clampSideW, loadSideHeight, loadSideWidth, saveSideSize, SIDE_H_MIN, SIDE_W_MIN, sideHMax, sideWMax } from './gamePrefs';
import type { KeywordCard, MergeResult, MyKeyword, PlayerSummary } from '../api/types';
import { remaining, shortLeft, STATE_BADGE } from './keywordFormat';
import { fmtNumber, t } from '../i18n';
import { getLang } from '../country';
import { PlayerSearch } from './PlayerSearch';
import { DEFAULT_GRADE_MINS, starLabel, tierOf } from './mergeFormat';
import { ScrollRow } from './ScrollRow';
import { StarRow } from './StarRow';
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
type SortKey = 'recent' | 'text' | 'state' | 'trend' | 'remaining' | 'length';
type SortDir = 'asc' | 'desc';
// 칩은 이 순서로 보인다. 기본 정렬인 남은 시간을 맨 앞에, 그다음에 트렌드 점수를 둔다
const SORT_LABEL: Record<SortKey, string> = { remaining: t('side.sortRemaining'), trend: t('side.sortTrend'), length: t('side.sortLength'), recent: t('side.sortRecent'), text: t('side.sortText'), state: t('side.sortState') };
/** 기준을 고르면 먼저 쓰는 방향: 최신·트렌드·남은 시간은 큰 것부터, 글자 수는 짧은 것부터, 키워드는 가나다, 상태는 🔥부터 */
const DEFAULT_DIR: Record<SortKey, SortDir> = { recent: 'desc', text: 'asc', state: 'asc', trend: 'desc', remaining: 'desc', length: 'asc' };
const STATE_ORDER: Record<string, number> = { 활성: 0, 비활성: 1, 금지: 2 };
/** 합성 이름의 글자 수 한도(서버 MergeKey.MAX_TEXT_LENGTH와 같다). 어긋나도 확정할 때 서버가 막는다 */
const MERGE_MAX_LENGTH = 20;
// 고른 정렬을 브라우저에 기억하는 키
const SORT_STORE = 'trendist.mineSort.v2';

// 고른 성(별 개수) 필터를 브라우저에 기억하는 키. 빈 목록은 전체
const STAR_STORE = 'trendist.mineStars.v1';
function loadStars(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(STAR_STORE) ?? 'null');
    if (Array.isArray(v) && v.every((n) => Number.isInteger(n) && n > 0)) return v;
  } catch { /* 전체 */ }
  return [];
}

/** 정렬 상태: null은 정렬 칩을 모두 끈 상태(기본 정렬인 남은 시간 많은 순으로 보인다). 칩은 누를 때마다 기본 방향 → 반대 방향 → 해제 순으로 돈다 */
type SortState = { key: SortKey; dir: SortDir } | null;
const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: 'remaining', dir: 'desc' };
const SORT_OFF = 'off';

function loadSort(): SortState {
  try {
    const raw = localStorage.getItem(SORT_STORE);
    if (raw === SORT_OFF) return null;
    const v = JSON.parse(raw ?? 'null');
    if (v && v.key in SORT_LABEL && (v.dir === 'asc' || v.dir === 'desc')) return v;
  } catch { /* 기본값 */ }
  return DEFAULT_SORT;
}

/** 보관함 카드의 글자 수: 서버의 합성 글자 수 한도와 같은 기준(구성 원본 이름을 구분자 없이 이은 코드포인트 수, 이름 속 띄어쓰기는 센다). 합성 카드의 이름에는 구분용 띄어쓰기가 있어 구성 이름으로 센다 */
const mineLength = (k: MyKeyword) => [...(k.merged && k.parts.length > 0 ? k.parts.map((p) => p.text).join('') : k.text)].length;

function sortMine(list: MyKeyword[], key: SortKey, dir: SortDir) {
  const sign = dir === 'asc' ? 1 : -1;
  const time = (iso: string) => new Date(iso).getTime();
  const compare = (a: MyKeyword, b: MyKeyword) => {
    switch (key) {
      case 'text': return a.text.localeCompare(b.text, getLang());
      case 'state': return (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9);
      case 'trend': return Number(a.trendValue) - Number(b.trendValue);
      case 'length': return mineLength(a) - mineLength(b);
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
  const [sort, setSort] = useState<SortState>(loadSort);
  const [mins, setMins] = useState<number[]>(DEFAULT_GRADE_MINS); // 카드 등급 기준(4.42)
  const [fail, setFail] = useState<{ per: number; max: number } | null>(null); // 합성 실패 확률 기준(성당 %, 상한 %)
  useEffect(() => { api.keywordGrades().then((g) => { if (Array.isArray(g.mins) && g.mins.length === 5) setMins(g.mins); if (typeof g.mergeFailPerStar === 'number') setFail({ per: g.mergeFailPerStar, max: g.mergeFailMax }); }).catch(() => { /* 기본 기준 */ }); }, []);
  const [starFilter, setStarFilter] = useState(loadStars);
  const starCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const k of mine) m.set(k.stars, (m.get(k.stars) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [mine]);
  // 보관함에 없는 성이 골라져 있으면(합성·만료로 사라짐) 필터에서 뺀다. 고른 성이 모두 사라지면 전체로 돌아간다
  const activeStars = useMemo(() => starFilter.filter((n) => starCounts.some(([s]) => s === n)), [starFilter, starCounts]);
  const sortedMine = useMemo(() => sortMine(mine, (sort ?? DEFAULT_SORT).key, (sort ?? DEFAULT_SORT).dir).filter((k) => activeStars.length === 0 || activeStars.includes(k.stars)), [mine, sort, activeStars]);

  // ---- 키워드 합성(4.44): 드래그(마우스)와 [🔗] 탭, 확정 전 미리보기, 합쳐지는 연출
  const [mergeFrom, setMergeFrom] = useState<number | null>(null); // 합성 모드: 이 카드와 합칠 짝을 고른다
  const merging = useRef(false); // 합성 요청 중(연타 방지)
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; over: number | null } | null>(null);
  const [blocked, setBlocked] = useState<{ from: number; reasons: Record<number, string> } | null>(null); // 출발 카드와 합칠 수 없는 카드 → 이유(서버가 한꺼번에 알려 준다)
  const [fresh, setFresh] = useState<{ id: number; bonus: boolean } | null>(null); // 방금 생긴 합성 카드
  const suppressClick = useRef(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);
  const mineById = useMemo(() => new Map(mine.map((k) => [k.keywordId, k])), [mine]);
  const source = drag?.id ?? mergeFrom;

  /** 서버에 묻지 않고 아는 불가 사유(💤 비활성, 구성 겹침). 글자 수 초과 등은 서버 판정을 따른다 */
  const localReason = useCallback((a: MyKeyword, b: MyKeyword): string | null => {
    if (a.state !== '활성' || b.state !== '활성') return t('merge.reasonInactive');
    const ids = new Set(a.merged ? a.parts.map((p) => p.keywordId) : [a.keywordId]);
    if ((b.merged ? b.parts.map((p) => p.keywordId) : [b.keywordId]).some((id) => ids.has(id))) return t('merge.reasonOverlap');
    // 글자 수 한도: 화면이 가진 구성 원본 이름만으로 바로 센다(서버와 같은 기준: 구분자 없이 이은 글자 수). 금지 조합만 서버가 알려 준다
    const over = [a, b].reduce((n, k) => n + [...(k.merged && k.parts.length > 0 ? k.parts.map((p) => p.text).join('') : k.text)].length, 0) - MERGE_MAX_LENGTH;
    if (over > 0) return t('merge.reasonTooLong', { n: over, max: MERGE_MAX_LENGTH });
    return null;
  }, []);
  const reasonFor = (id: number): string | null => {
    const a = source != null ? mineById.get(source) : undefined, b = mineById.get(id);
    if (!a || !b || a === b) return null;
    return localReason(a, b) ?? (blocked?.from === a.keywordId ? blocked.reasons[b.keywordId] ?? null : null);
  };

  const endMerge = useCallback(() => { setMergeFrom(null); setBlocked(null); }, []);
  /** 두 카드를 확인 창 없이 바로 합친다. 합칠 수 없으면(서버 판정 포함) 이유를 알림으로 보여 준다 */
  const openPair = useCallback((aId: number, bId: number) => {
    const a = mineById.get(aId), b = mineById.get(bId);
    if (!a || !b || a === b || merging.current) return;
    const chain = mergeFrom !== null; // [🔗]로 시작했다면 결과를 다음 출발 카드로 이어 연속으로 합친다(끌어서 합치기는 한 번으로 끝)
    endMerge();
    const why = localReason(a, b);
    if (why) { onError(why); return; }
    merging.current = true;
    api.merge(a.keywordId, b.keywordId)
      .then((r) => { handleMerged(r, a, b); if (chain && r.keyword && r.keyword.state === '활성' && (activeStars.length === 0 || activeStars.includes(r.keyword.stars))) setMergeFrom(r.keyword.keywordId); })
      .catch((e) => onError(e instanceof ApiFailure ? e.message : t('merge.failed')))
      .finally(() => { merging.current = false; });
  }, [mineById, mergeFrom, activeStars, endMerge, localReason, onError]); // eslint-disable-line react-hooks/exhaustive-deps

  // 합성 모드를 켜거나 끌기를 시작하면 합칠 수 없는 카드를 한꺼번에 받아 흐리게 보여 준다(글자 수 초과·금지 조합처럼 서버만 아는 이유 포함).
  // 응답 전에는 이미 아는 이유(💤·구성 겹침)만 보이고, 실패하면 확정 때 이유를 알려 준다
  useEffect(() => {
    if (source == null) return;
    let alive = true;
    api.mergeBlocked(source).then((reasons) => { if (alive) setBlocked({ from: source, reasons }); }).catch(() => { /* 확정 때 알려 준다 */ });
    return () => { alive = false; };
  }, [source]);

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
      setDrag(null);
    };
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        started = true; setMergeFrom(null);
      }
      const over = idAt(ev.clientX, ev.clientY);
      setDrag({ id: k.keywordId, x: ev.clientX, y: ev.clientY, over: over === k.keywordId ? null : over });
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
    if (r.failed || !r.keyword) { void loadMine(); return; } // 실패: 사라진 재료를 반영하려고 보관함을 새로 읽는다
    const kw = r.keyword;
    {
      setMine((list) => [...list.filter((k) => k.keywordId !== a?.keywordId && k.keywordId !== b?.keywordId && k.keywordId !== kw.keywordId), kw]);
      setFresh({ id: kw.keywordId, bonus: r.bonus });
      void loadMine();
      timers.current.push(window.setTimeout(() => setFresh((f) => (f?.id === kw.keywordId ? null : f)), 550));
    }
  }

  useEffect(() => {
    try { localStorage.setItem(SORT_STORE, sort ? JSON.stringify(sort) : SORT_OFF); } catch { /* 이 브라우저에만 기억 */ }
  }, [sort]);
  useEffect(() => {
    try { localStorage.setItem(STAR_STORE, JSON.stringify(starFilter)); } catch { /* 이 브라우저에만 기억 */ }
  }, [starFilter]);

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
                  const active = sort?.key === k;
                  return (
                    <button key={k} className={active ? 'sort-chip active' : 'sort-chip'} aria-pressed={active}
                            title={active ? (sort?.dir === DEFAULT_DIR[k] ? t('side.sortFlip') : t('side.sortOff')) : undefined}
                            aria-label={active ? t('side.sortActiveAria', { label: SORT_LABEL[k], dir: sort?.dir === 'asc' ? t('side.asc') : t('side.desc') }) : t('side.sortByAria', { label: SORT_LABEL[k] })}
                            onClick={() => setSort((s) => (s?.key !== k ? { key: k, dir: DEFAULT_DIR[k] } : s.dir === DEFAULT_DIR[k] ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : null))}>
                      {SORT_LABEL[k]}
                      {active && <span className="sort-arrow" aria-hidden="true">{sort?.dir === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  );
                })}
              </ScrollRow>
              {/* 성(별 개수) 필터: 보관함에 있는 성만 칩으로 보이고 개수가 붙는다. 여러 성을 함께 고를 수 있다 */}
              {starCounts.some(([s]) => s > 1) && (
                <ScrollRow className="sort-chips star-chips" role="group" aria-label={t('side.starGroup')}>
                  <button className={activeStars.length === 0 ? 'sort-chip active' : 'sort-chip'} aria-pressed={activeStars.length === 0} onClick={() => setStarFilter([])}>{t('side.starAll')}</button>
                  {starCounts.map(([s, n]) => {
                    const on = activeStars.includes(s);
                    return (
                      <button key={s} className={on ? 'sort-chip active' : 'sort-chip'} aria-pressed={on}
                              aria-label={t('side.starChipAria', { n: s, count: n })}
                              onClick={() => setStarFilter(on ? activeStars.filter((x) => x !== s) : [...activeStars, s])}>
                        <span className="star-unit" aria-hidden="true"><span className="star-mark">★</span><span className="star-times">×{s}</span></span><span className="star-count" aria-hidden="true">({n})</span>
                      </button>
                    );
                  })}
                </ScrollRow>
              )}
            </div>
            <ul className={source != null ? 'list merge-active' : 'list'}>
              {sortedMine.map((k) => {
                const id = k.keywordId;
                // 합성 모드에서 카드를 눌렀다: 출발 카드면 모드 끝, 로컬에서 불가가 확실하면 무시, 그 밖에는 미리보기(서버가 이유를 알려 준다)
                const pick = () => { if (mergeFrom === id) endMerge(); else if (mergeFrom !== null && !localReason(mineById.get(mergeFrom)!, k)) openPair(mergeFrom, id); };
                const role = source == null ? null : id === source ? 'source' : reasonFor(id) ? 'bad' : 'ok';
                return (
                  <MineCard key={id} k={k} mins={mins} role={role} reason={role === 'bad' ? reasonFor(id) : null}
                            failPct={role === 'ok' && fail && source != null && mineById.get(source) ? Math.min(fail.max, fail.per * (mineById.get(source)!.stars + k.stars)) : null}
                            over={drag?.over === id} merging={null}
                            fresh={fresh?.id === id ? (fresh.bonus ? 'bonus' : 'yes') : null}
                            onOpen={() => { if (!suppressClick.current) onOpenKeyword(id, k.merged); }}
                            onLink={() => { if (suppressClick.current) return; if (mergeFrom === null) setMergeFrom(id); else pick(); }}
                            onLinkDown={(e) => startDrag(e, k, true)}
                            mode={mergeFrom !== null}
                            onPick={pick}
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

type Fx = 'yes' | 'bonus' | null;

/**
 * 보관함 키워드 카드(4.42): 이름·상태 배지 아래에 남은 시간 게이지가 있다. 게이지는 처음 +한 시간(또는 갱신한 시간)부터 사라질 때까지 줄어들고,
 * 절반 아래는 주황, 1시간 아래는 빨강으로 깜빡인다. 남은 시간 글자도 있어 색에만 기대지 않는다.
 * 카드의 모양은 키워드 **점수**로 달라진다(점수는 가진 사람이 많을수록 오른다): 왼쪽 띠와 점수 칩이 15점부터 초록, 30점부터 주황, 50점부터 금빛, 100점부터 보랏빛 그라데이션이 된다.
 * 상태(활성·비활성)는 배지 하나로만 보여 준다(불꽃 아이콘을 더 붙이지 않는다).
 * 합성 키워드(4.44)는 이름 앞에 ★이 붙는다(4성 이상은 ★4). 이름이 구성 원본을 띄어 쓴 것이라 구성을 따로 적지 않는다. 오른쪽 [🔗]는 합성 모드를 켠다.
 * role: 합성 모드·드래그 중의 역할(source 출발 · ok 합칠 수 있음 · bad 합칠 수 없음, reason에 이유).
 */
function MineCard({ k, mins, role, reason, failPct, over, merging, fresh, mode, onOpen, onLink, onLinkDown, onPick, onDragStart }: {
  k: MyKeyword; mins: number[]; role: 'source' | 'ok' | 'bad' | null; reason: string | null; failPct: number | null; over: boolean; merging: Fx; fresh: Fx; mode: boolean;
  onOpen(): void; onLink(): void; onLinkDown(e: ReactPointerEvent): void; onPick(): void; onDragStart(e: ReactPointerEvent): void;
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
  const len = mineLength(k);
  return (
    <li className={cls} data-mine-id={k.keywordId} title={reason ?? undefined}>
      <button className="mine-open" onClick={mode ? onPick : onOpen} onPointerDown={onDragStart}
              aria-label={t('side.openAria', { kw: k.text })} aria-disabled={role === 'bad' || undefined}>
        <div className="mine-row1">
          {hasStars
            ? <StarRow stars={k.stars} label={t('merge.starsAria', { n: k.stars })} />  /* 별을 개수 그대로, 한 줄에 넘치면 ★×N */
            : <span className="mine-stars"><span className="badge">{STATE_BADGE[k.state] ?? k.state}</span></span>} {/* 비활성은 별 자리에 상태 태그 */}
          <span className="mine-tags">
            {/* 글자 수(합성 한도 20자 대비): 숫자만 있는 작은 태그. 점수 태그의 왼쪽에 둔다 */}
            {failPct != null && <span className="mine-fail" title={t('merge.failChanceTitle')}>{t('merge.failChance', { p: Math.round(failPct) })}</span>}
            <span className="mine-len" title={t('side.lengthTitle', { n: len })} aria-label={t('side.lengthTitle', { n: len })}>{len}</span>
            <span className="mine-score" title={tier > 0 ? t(`side.tier${tier}`) : undefined}>{t('side.points', { n: fmtNumber(k.trendValue) })}</span>
          </span>
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

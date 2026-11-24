import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
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
import { visibleInterval } from './visibleInterval';
import { mineBus } from './mineBus';
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

/** 보관함 카드를 처음 만드는 개수와, 스크롤할 때 한 번에 더 만드는 개수 */
const MINE_FIRST = 24, MINE_CHUNK = 20;

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

/** 합성이 끝나기 전에 "합쳐지면 이런 키워드가 된다"를 흉내 낸 카드: 연속으로 눌러 둔 다음 카드와 합칠 수 있는지 미리 보는 데 쓴다(구성·글자 수·활성 여부만 맞으면 된다) */
const partsOfMine = (k: MyKeyword): MyKeyword['parts'] => (k.merged && k.parts.length > 0 ? k.parts : [{ keywordId: k.keywordId, text: k.text, state: k.state, trendValue: k.trendValue }]);
const combineMine = (a: MyKeyword, b: MyKeyword): MyKeyword => ({ ...a, merged: true, state: '활성', stars: a.stars + b.stars, parts: [...partsOfMine(a), ...partsOfMine(b)] });

const samePart = (a: MyKeyword['parts'][number], b: MyKeyword['parts'][number]) => a.keywordId === b.keywordId && a.trendValue === b.trendValue && a.state === b.state && a.text === b.text;
const sameMine = (a: MyKeyword, b: MyKeyword) => a.keywordId === b.keywordId && a.text === b.text && a.state === b.state && a.trendValue === b.trendValue
  && a.plusedAt === b.plusedAt && a.expiresAt === b.expiresAt && a.merged === b.merged && a.stars === b.stars
  && a.parts.length === b.parts.length && a.parts.every((p, i) => samePart(p, b.parts[i]));

/** 새로 읽은 보관함을 이전 목록과 맞춘다: 같은 키워드는 이전 객체를 재사용하고, 아무것도 달라지지 않았으면 이전 배열을 그대로 돌려줘 다시 그리지 않게 한다 */
function reconcileMine(prev: MyKeyword[], next: MyKeyword[]): MyKeyword[] {
  const byId = new Map(prev.map((k) => [k.keywordId, k]));
  let changed = prev.length !== next.length;
  const out = next.map((n, i) => {
    const old = byId.get(n.keywordId);
    const keep = old && sameMine(old, n) ? old : n;
    if (keep !== prev[i]) changed = true;
    return keep;
  });
  return changed ? out : prev;
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

function SidePanelImpl({ onPlused, onMerged, onError, refreshKey, onOpenKeyword, onSharePlayer, searchRequest, openRequest, onHide }: Props) {
  const layer = useLayer('side');
  const [tab, setTab] = useState<Tab>('search');
  const [q, setQ] = useState('');
  const [card, setCard] = useState<KeywordCard | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mine, setMine] = useState<MyKeyword[]>([]);
  const [tick, minuteTick] = useState(0); // 시계가 매 분 정각을 지날 때 올라가 카드가 남은 시간을 다시 계산하게 한다(카드는 memo라 값이 바뀔 때만 다시 그린다)
  useEffect(() => {
    // 남은 시간은 분 단위로만 보이므로 1분마다, 그것도 현재 시각의 분이 바뀌는 순간(00초)에 맞춰 한 번만 다시 계산한다(4.42)
    let id = 0;
    const schedule = () => { id = window.setTimeout(() => { minuteTick((n) => n + 1); schedule(); }, 60_000 - (Date.now() % 60_000) + 50); };
    schedule();
    return () => window.clearTimeout(id);
  }, []);
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
  /**
   * 합성을 진행한다. chain이면([🔗]로 시작한 연속 합성) 결과가 다음 출발 카드가 되어 합성 모드가 이어지고, 진행 중에 눌러 둔 다음 카드들(mergeQueue)을
   * 결과가 나오는 대로 차례로 합친다(빠르게 연달아 눌러도 클릭이 버려지지 않는다). 서버가 막거나 실패하면 대기열을 비우고 모드를 끝낸다.
   */
  const mergeQueue = useRef<number[]>([]);
  const chainHead = useRef<MyKeyword | null>(null); // 진행 중인 합성의 (예상) 결과: 다음 카드를 눌렀을 때 합칠 수 있는지 미리 보는 데 쓴다
  const [queuedIds, setQueuedIds] = useState<number[]>([]);
  const [pendingMerge, setPendingMerge] = useState<string | null>(null); // 합성 요청 중: 재료 카드는 바로 사라지고 이 자리표시 카드가 결과를 기다린다
  const runMerge = useCallback(async (a: MyKeyword, b: MyKeyword, chain: boolean) => {
    merging.current = true;
    chainHead.current = combineMine(a, b);
    let src = a;
    let keepGoing = false;
    try {
      let tgt: MyKeyword | undefined = b;
      while (tgt) {
        // 재료 두 장은 요청을 보내는 순간 목록에서 뺀다(응답을 기다리는 동안 다시 눌러 "보관함에 없는 키워드" 오류가 나지 않게). 결과가 오면 합성 키워드가 들어온다
        mineEdits.current++;
        setMine((list) => list.filter((k) => k.keywordId !== src.keywordId && k.keywordId !== tgt!.keywordId));
        setPendingMerge(`${partsOfMine(src).concat(partsOfMine(tgt)).map((p) => p.text).join(' + ')}`);
        const r = await api.merge(src.keywordId, tgt.keywordId);
        setPendingMerge(null);
        handleMerged(r, src, tgt);
        keepGoing = chain && !!r.keyword && !r.failed && r.keyword.state === '활성';
        if (!keepGoing || !r.keyword) break;
        src = r.keyword;
        setMergeFrom(src.keywordId); // 모드의 출발 카드가 결과를 따라간다
        const nextId = mergeQueue.current.shift();
        setQueuedIds([...mergeQueue.current]);
        tgt = nextId === undefined ? undefined : mineRef.current.find((k) => k.keywordId === nextId);
        chainHead.current = tgt ? mergeQueue.current.reduce((h, id) => { const k = mineRef.current.find((x) => x.keywordId === id); return k ? combineMine(h, k) : h; }, combineMine(src, tgt)) : src;
      }
    } catch (e) {
      keepGoing = false;
      onError(e instanceof ApiFailure ? e.message : t('merge.failed'));
      mineEdits.current++; // 서버 상태가 어떻게 됐는지 모르므로 처음부터 다시 읽어 맞춘다
      void loadMine();
    } finally {
      setPendingMerge(null);
      window.setTimeout(() => { void loadMine(); }, 1500); // 합성이 모두 끝난 뒤 서버 값으로 한 번 맞춘다
      merging.current = false;
      chainHead.current = null;
      mergeQueue.current = [];
      setQueuedIds([]);
      if (!keepGoing || (activeStars.length > 0 && !activeStars.includes(src.stars))) endMerge();
    }
  }, [activeStars, endMerge, onError]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 두 카드를 확인 창 없이 바로 합친다. 합칠 수 없으면(서버 판정 포함) 이유를 알림으로 보여 준다 */
  const openPair = useCallback((aId: number, bId: number) => {
    const a = mineById.get(aId), b = mineById.get(bId);
    if (!a || !b || a === b || merging.current) return;
    const chain = mergeFrom !== null; // [🔗]로 시작했다면 결과를 다음 출발 카드로 이어 연속으로 합친다(끌어서 합치기는 한 번으로 끝)
    const why = localReason(a, b);
    if (why) { onError(why); if (!chain) endMerge(); return; }
    if (!chain) endMerge();
    void runMerge(a, b, chain);
  }, [mineById, mergeFrom, endMerge, localReason, onError, runMerge]);

  /** 합성이 진행 중일 때 다음 카드를 눌렀다: 합칠 수 있으면 대기열에 넣어 결과가 나오는 대로 이어서 합친다 */
  const enqueueMerge = useCallback((k: MyKeyword) => {
    const head = chainHead.current;
    if (!head) return;
    if (mergeQueue.current.includes(k.keywordId)) return;
    const why = localReason(head, k);
    if (why) { onError(why); return; }
    mergeQueue.current.push(k.keywordId);
    chainHead.current = combineMine(head, k);
    setQueuedIds([...mergeQueue.current]);
  }, [localReason, onError]);

  // 합성 모드를 켜거나 끌기를 시작하면 합칠 수 없는 카드를 한꺼번에 받아 흐리게 보여 준다(글자 수 초과·금지 조합처럼 서버만 아는 이유 포함).
  // 응답 전에는 이미 아는 이유(💤·구성 겹침)만 보이고, 실패하면 확정 때 이유를 알려 준다
  useEffect(() => {
    if (source == null || !mineRef.current.some((k) => k.keywordId === source)) return; // 합성 중이라 이미 목록에서 빠진 출발 카드는 묻지 않는다
    let alive = true;
    // 연속 합성으로 출발 카드가 잇따라 바뀔 때 매번 묻지 않도록 0.3초 기다렸다가 마지막 것만 묻는다
    const id = window.setTimeout(() => { api.mergeBlocked(source).then((reasons) => { if (alive) setBlocked({ from: source, reasons }); }).catch(() => { /* 확정 때 알려 준다 */ }); }, 300);
    return () => { alive = false; window.clearTimeout(id); };
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
      mineEdits.current++;
      setMine((list) => [...list.filter((k) => k.keywordId !== a?.keywordId && k.keywordId !== b?.keywordId && k.keywordId !== kw.keywordId), kw]);
      setFresh({ id: kw.keywordId, bonus: r.bonus }); // 목록은 위에서 직접 고쳤으므로 보관함 전체를 다시 읽지 않는다(1분마다 맞춘다)
      timers.current.push(window.setTimeout(() => setFresh((f) => (f?.id === kw.keywordId ? null : f)), 550));
    }
  }

  useEffect(() => {
    try { localStorage.setItem(SORT_STORE, sort ? JSON.stringify(sort) : SORT_OFF); } catch { /* 이 브라우저에만 기억 */ }
  }, [sort]);
  useEffect(() => {
    try { localStorage.setItem(STAR_STORE, JSON.stringify(starFilter)); } catch { /* 이 브라우저에만 기억 */ }
  }, [starFilter]);

  /** 서버 보관함을 읽는다. 내용이 달라지지 않은 카드는 이전 객체를 그대로 써서(memo 카드가 다시 그려지지 않게) 키워드가 많아도 가볍다 */
  // 읽는 동안 화면이 목록을 직접 고쳤다면(합성으로 재료가 사라지는 등) 그 전에 요청한 응답은 낡은 것이라 버린다(사라진 카드가 되살아나 "보관함에 없는 키워드" 오류를 부르지 않게)
  const mineEdits = useRef(0);
  async function loadMine() {
    const v = mineEdits.current;
    try { const next = await api.myKeywords(); if (v === mineEdits.current) setMine((prev) => reconcileMine(prev, next)); } catch { /* 다음에 다시 */ }
  }

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
  // 구슬 결과가 알려 준 변화(새로 얻음·만료 갱신)는 목록만 직접 고친다. 목록에 없는 카드의 갱신(합성 키워드로 가진 경우 등)은 어긋날 수 있어 모아서 한 번 다시 읽는다
  const mineRef = useRef<MyKeyword[]>([]);
  mineRef.current = mine;
  const reloadTimer = useRef(0);
  useEffect(() => mineBus.subscribe((events) => {
    const nowIso = new Date().toISOString();
    const known = new Set(mineRef.current.map((k) => k.keywordId));
    let unknownRenew = false;
    for (const e of events) { if (e.kind === 'gain') known.add(e.keywordId); else if (!known.has(e.keywordId)) unknownRenew = true; }
    // 모인 변화를 한 번에 목록에 적용한다(정렬·필터도 한 번만 다시 계산된다)
    setMine((list) => {
      let next = list;
      for (const e of events) {
        const i = next.findIndex((k) => k.keywordId === e.keywordId);
        if (e.kind === 'gain' && i < 0) {
          next = [...next, { keywordId: e.keywordId, text: e.text, state: e.state, trendValue: e.trendValue, plusedAt: nowIso, expiresAt: e.expiresAt, merged: false, stars: 1, parts: [] }];
        } else if (i >= 0 && !next[i].merged) {
          next = next.map((k, j) => (j === i ? { ...k, plusedAt: nowIso, expiresAt: e.expiresAt } : k));
        }
      }
      return next;
    });
    if (unknownRenew) { // 목록에 없는데 갱신만 왔다: 합성 키워드 안의 원본일 수 있다
      window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => { void loadMine(); }, 700);
    }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 처음에는 바로 읽고, 그 뒤 refreshKey가 바뀔 때(구슬·키워드 변화가 잇따를 때)는 0.7초 모아 한 번만 읽는다. 키워드가 수백 개면 한 번 읽는 것도 무겁다
  const loadedOnce = useRef(false);
  useEffect(() => {
    const t = window.setTimeout(loadMine, loadedOnce.current ? 700 : 0);
    loadedOnce.current = true;
    const stop = visibleInterval(loadMine, 60_000);
    return () => { window.clearTimeout(t); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]); // 탭을 오갈 때는 다시 읽지 않는다(보관함 개수는 늘 읽어 두고 있다)

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

  // 검색·보관함 탭은 한 번 열면 계속 붙여 두고 숨기기만 한다: 탭을 오갈 때마다 카드 수백 개를 지웠다 다시 만들면 그때마다 렉이 걸린다
  const visited = useRef({ search: true });
  if (tab === 'search') visited.current.search = true;
  // 보관함은 접속 직후 한가한 때(1.5초 뒤)에 보이지 않게 첫 묶음만 미리 만들어 두고, 그 전에 열면 바로 만든다
  const [mineMounted, setMineMounted] = useState(false);
  useEffect(() => { if (tab === 'mine') setMineMounted(true); }, [tab]);
  useEffect(() => { const id = window.setTimeout(() => setMineMounted(true), 1500); return () => window.clearTimeout(id); }, []);
  // 카드는 한꺼번에 수백 개를 만들면 화면이 멈추므로 처음 24개만 만들고, 목록 맨 아래가 보일 만큼 스크롤하면 20개씩 더 만든다(한 번 만든 카드는 그대로 둔다)
  const [shown, setShown] = useState(MINE_FIRST);
  // 정렬·필터를 바꾸면 목록이 달라지므로 처음 개수부터 다시 보여 준다(앞에서 많이 불러왔어도 바뀐 목록을 한꺼번에 그리지 않는다)
  useEffect(() => { setShown(MINE_FIRST); }, [sort, activeStars]);
  const moreRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = moreRef.current;
    if (!el || shown >= sortedMine.length) return;
    // 숨겨진 탭에서는 보이지 않아 불리지 않는다. 더 만든 뒤에도 아직 보이면 새 관찰자가 바로 다시 불러 화면이 찰 때까지 이어진다
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setShown((n) => Math.min(n + MINE_CHUNK, sortedMine.length)); }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, sortedMine.length, mineMounted, tab]);

  // 카드(memo)에 넘기는 핸들러는 늘 같은 함수여야 카드가 다시 그려지지 않는다. 최신 상태는 ref를 거쳐 읽는다
  const live = useRef({
    open: (_k: MyKeyword) => {}, link: (_k: MyKeyword) => {}, pick: (_k: MyKeyword) => {}, linkDown: (_e: ReactPointerEvent, _k: MyKeyword) => {}, dragStart: (_e: ReactPointerEvent, _k: MyKeyword) => {},
  });
  live.current = {
    open: (k) => { if (!suppressClick.current) onOpenKeyword(k.keywordId, k.merged); },
    // 합성 모드에서 카드를 눌렀다: 출발 카드면 모드 끝, 로컬에서 불가가 확실하면 무시, 그 밖에는 바로 합친다(서버가 이유를 알려 준다)
    pick: (k) => {
      if (mergeFrom === null) return;
      if (merging.current) { enqueueMerge(k); return; } // 합성이 진행 중이면 다음 카드를 대기열에 넣는다(클릭이 버려지지 않는다)
      if (mergeFrom === k.keywordId) endMerge(); else if (!localReason(mineById.get(mergeFrom)!, k)) openPair(mergeFrom, k.keywordId);
    },
    link: (k) => { if (suppressClick.current) return; if (mergeFrom === null) setMergeFrom(k.keywordId); else live.current.pick(k); },
    linkDown: (e, k) => startDrag(e, k, true),
    dragStart: (e, k) => startDrag(e, k),
  };
  const cardOpen = useCallback((k: MyKeyword) => live.current.open(k), []);
  const cardPick = useCallback((k: MyKeyword) => live.current.pick(k), []);
  const cardLink = useCallback((k: MyKeyword) => live.current.link(k), []);
  const cardLinkDown = useCallback((e: ReactPointerEvent, k: MyKeyword) => live.current.linkDown(e, k), []);
  const cardDragStart = useCallback((e: ReactPointerEvent, k: MyKeyword) => live.current.dragStart(e, k), []);

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

      {visited.current.search && (
        <div className="tab-body" style={tab === 'search' ? undefined : { display: 'none' }}>
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

      {mineMounted && (
        <div className="tab-body" style={tab === 'mine' ? undefined : { display: 'none' }}>
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
              {pendingMerge !== null && (
                <li className="mine-item mine-card merge-source mine-pending" role="status" aria-live="polite">
                  <div className="mine-pending-body"><span className="mine-pending-spin" aria-hidden="true" /><strong title={pendingMerge}>{pendingMerge}</strong><span className="muted small">{t('merge.pending')}</span></div>
                </li>
              )}
              {sortedMine.slice(0, shown).map((k) => {
                const id = k.keywordId;
                const role = source == null ? null : id === source ? 'source' : reasonFor(id) ? 'bad' : 'ok';
                return (
                  <MineCard key={id} k={k} mins={mins} role={role} reason={role === 'bad' ? reasonFor(id) : null}
                            failPct={role === 'ok' && fail && source != null && mineById.get(source) ? Math.min(fail.max, fail.per * (mineById.get(source)!.stars + k.stars)) : null}
                            over={drag?.over === id}
                            fresh={fresh?.id === id ? (fresh.bonus ? 'bonus' : 'yes') : null}
                            mode={mergeFrom !== null} tick={tick} queuedAt={queuedIds.indexOf(id) + 1 || null}
                            onOpen={cardOpen} onLink={cardLink} onLinkDown={cardLinkDown} onPick={cardPick} onDragStart={cardDragStart} />
                );
              })}
              {shown < sortedMine.length && <li ref={moreRef} className="muted small mine-loading" role="status">{t('side.loadingMore', { n: sortedMine.length - shown })}</li>}
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

/** 상위(GameScreen)가 점수·핑 같은 것으로 자주 다시 그려져도, 받는 값이 그대로면 보관함 패널은 다시 그리지 않는다 */
export const SidePanel = memo(SidePanelImpl);

type Fx = 'yes' | 'bonus' | null;

/**
 * 보관함 키워드 카드(4.42): 이름·상태 배지 아래에 남은 시간 게이지가 있다. 게이지는 처음 +한 시간(또는 갱신한 시간)부터 사라질 때까지 줄어들고,
 * 절반 아래는 주황, 1시간 아래는 빨강으로 깜빡인다. 남은 시간 글자도 있어 색에만 기대지 않는다.
 * 카드의 모양은 키워드 **점수**로 달라진다(점수는 가진 사람이 많을수록 오른다): 왼쪽 띠와 점수 칩이 15점부터 초록, 30점부터 주황, 50점부터 금빛, 100점부터 보랏빛 그라데이션이 된다.
 * 상태(활성·비활성)는 배지 하나로만 보여 준다(불꽃 아이콘을 더 붙이지 않는다).
 * 합성 키워드(4.44)는 이름 앞에 ★이 붙는다(4성 이상은 ★4). 이름이 구성 원본을 띄어 쓴 것이라 구성을 따로 적지 않는다. 오른쪽 [🔗]는 합성 모드를 켠다.
 * role: 합성 모드·드래그 중의 역할(source 출발 · ok 합칠 수 있음 · bad 합칠 수 없음, reason에 이유).
 */
const MineCard = memo(function MineCard({ k, mins, role, reason, failPct, over, fresh, mode, tick, queuedAt, onOpen, onLink, onLinkDown, onPick, onDragStart }: {
  k: MyKeyword; mins: number[]; role: 'source' | 'ok' | 'bad' | null; reason: string | null; failPct: number | null; over: boolean; fresh: Fx; mode: boolean;
  queuedAt: number | null; // 합성 진행 중에 눌러 둔 순서(1부터). 없으면 null
  tick: number; // 30초마다 바뀌는 값: 남은 시간 게이지를 다시 계산하게 한다(memo가 이 값이 바뀔 때만 다시 그린다)
  onOpen(k: MyKeyword): void; onLink(k: MyKeyword): void; onLinkDown(e: ReactPointerEvent, k: MyKeyword): void; onPick(k: MyKeyword): void; onDragStart(e: ReactPointerEvent, k: MyKeyword): void;
}) {
  void tick;
  const left = new Date(k.expiresAt).getTime() - Date.now();
  const total = Math.max(new Date(k.expiresAt).getTime() - new Date(k.plusedAt).getTime(), left, 1);
  const ratio = Math.max(0, Math.min(1, left / total));
  const tone = left < 3_600_000 ? 'urgent' : ratio < 0.5 ? 'mid' : 'ok';
  const tier = tierOf(k.trendValue, mins);
  const hasStars = k.merged || k.state === '활성';
  const lf = shortLeft(k.expiresAt);
  const cls = ['mine-item', 'mine-card', tone, `tier${tier}`, k.merged && 'merged', role && `merge-${role}`, over && 'merge-over',
    fresh && `merge-fresh${fresh === 'bonus' ? ' bonus' : ''}`].filter(Boolean).join(' ');
  const inactive = k.state !== '활성';
  const len = mineLength(k);
  return (
    <li className={cls} data-mine-id={k.keywordId} title={reason ?? undefined}>
      <button className="mine-open" onClick={() => (mode ? onPick(k) : onOpen(k))} onPointerDown={(e) => onDragStart(e, k)}
              aria-label={t('side.openAria', { kw: k.text })} aria-disabled={role === 'bad' || undefined}>
        <div className="mine-row1">
          {hasStars
            ? <StarRow stars={k.stars} label={t('merge.starsAria', { n: k.stars })} />  /* 별을 개수 그대로, 한 줄에 넘치면 ★×N */
            : <span className="mine-stars"><span className="badge">{STATE_BADGE[k.state] ?? k.state}</span></span>} {/* 비활성은 별 자리에 상태 태그 */}
          <span className="mine-tags">
            {/* 글자 수(합성 한도 20자 대비): 숫자만 있는 작은 태그. 점수 태그의 왼쪽에 둔다 */}
            {queuedAt !== null && <span className="mine-queued" title={t('merge.queuedTitle')}>{queuedAt}</span>}
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
              onClick={() => onLink(k)} onPointerDown={(e) => onLinkDown(e, k)}
              aria-pressed={role === 'source'} aria-label={role === 'source' && mode ? t('merge.modeExit') : t('merge.linkAria', { kw: k.text })}
              title={inactive ? t('merge.reasonInactive') : role === 'source' && mode ? t('merge.modeExit') : t('merge.linkTitle')}><span aria-hidden="true">{t('merge.linkBtn')}</span></button>
      {reason && ( /* 합칠 수 없는 카드: 카드 높이가 늘어나지 않게 카드 위에 회색 금지 표시와 이유를 겹쳐 띄운다 */
        <div className="merge-block" role="note"><span className="merge-block-icon" aria-hidden="true">🚫</span><span className="merge-block-text">{reason}</span></div>
      )}
    </li>
  );
});

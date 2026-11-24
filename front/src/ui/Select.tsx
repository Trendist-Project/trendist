import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './select.css';

/**
 * 공통 선택 상자. 브라우저 기본 <select> 대신 쓴다(어두운 화면과 어울리지 않고, 설명·묶음·검색을 못 넣는다).
 * - 키보드: 버튼에서 Enter·Space·↑·↓로 열고, ↑↓·Home·End로 옮기고, Enter로 고르고, Esc로 닫는다. 글자를 치면 그 글자로 시작하는 항목으로 간다.
 * - 항목마다 한 줄 설명(hint)·아이콘·묶음(group)·비활성을 둘 수 있고, 항목이 많으면(searchable) 검색 칸이 생긴다.
 * - 목록은 document.body에 띄워(portal) 표·카드의 overflow에 잘리지 않고, 아래 공간이 모자라면 위로 펼친다.
 * - 스크린 리더: combobox + listbox 패턴(aria-activedescendant).
 */
export interface SelectOption<T extends string | number> {
  value: T; label: string; hint?: string; icon?: ReactNode; group?: string; disabled?: boolean;
}
interface Props<T extends string | number> {
  value: T | null;
  options: SelectOption<T>[];
  onChange(value: T): void;
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
  id?: string;
  size?: 'sm' | 'md';
  className?: string;
  /** 목록 폭: trigger는 버튼과 같게, auto는 내용에 맞게(버튼보다 좁지 않게) */
  menuWidth?: 'trigger' | 'auto';
  /** 목록을 버튼의 오른쪽 끝에 맞출지 */
  align?: 'start' | 'end';
  /** 검색 칸. 기본은 항목이 10개를 넘으면 */
  searchable?: boolean;
  emptyText?: string;
}

const MAX_H = 320, GAP = 6;

export function Select<T extends string | number>({ value, options, onChange, placeholder = '선택', disabled, id, size = 'md', className, menuWidth = 'trigger', align = 'start', searchable, emptyText = '결과가 없어요', ...rest }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxH: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const typed = useRef({ s: '', at: 0 }), openedAt = useRef(0);
  const uid = useId(), listId = `${uid}-list`;
  const canSearch = searchable ?? options.length > 10;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q)) : options;
  }, [options, query]);
  const selected = options.find((o) => o.value === value) ?? null;

  const close = useCallback((focusBack = true) => { setOpen(false); setQuery(''); if (focusBack) btn.current?.focus(); }, []);
  const openMenu = useCallback(() => {
    if (disabled) return;
    const i = options.findIndex((o) => o.value === value && !o.disabled);
    setActive(i >= 0 ? i : options.findIndex((o) => !o.disabled)); setOpen(true);
  }, [disabled, options, value]);

  // 위치: 버튼 아래(공간이 모자라면 위). 열려 있는 동안 창 크기가 바뀌면 다시 잰다
  const place = useCallback(() => {
    const el = btn.current; if (!el) return;
    const r = el.getBoundingClientRect(), below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    const up = below < 200 && above > below, width = Math.max(r.width, menuWidth === 'auto' ? 220 : 0);
    const left = Math.max(8, Math.min(align === 'end' ? r.right - width : r.left, window.innerWidth - width - 8));
    setPos(up ? { bottom: window.innerHeight - r.top + GAP, left, width, maxH: Math.min(MAX_H, above) } : { top: r.bottom + GAP, left, width, maxH: Math.min(MAX_H, below) });
  }, [menuWidth, align]);
  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !btn.current?.contains(t)) close(false); };
    const onScroll = (e: Event) => { if (performance.now() - openedAt.current < 300) return; if (!pop.current?.contains(e.target as Node)) close(false); }; // 막 열린 직후의 스크롤(포커스 이동 등)은 무시 // 뒤쪽 화면이 스크롤되면 닫는다(목록만 따로 떠 있지 않게)
    document.addEventListener('pointerdown', onDown); window.addEventListener('resize', place); window.addEventListener('scroll', onScroll, true);
    openedAt.current = performance.now();
    if (canSearch) window.setTimeout(() => search.current?.focus({ preventScroll: true }), 0);
    return () => { document.removeEventListener('pointerdown', onDown); window.removeEventListener('resize', place); window.removeEventListener('scroll', onScroll, true); };
  }, [open, close, place, canSearch]);
  useEffect(() => { // 고른 항목이 목록 안에서 보이게 한다. scrollIntoView는 페이지까지 스크롤시켜 목록이 닫히므로 목록의 scrollTop만 직접 조절한다
    if (!open || active < 0) return;
    const list = pop.current?.querySelector<HTMLElement>('.sel-list'), el = list?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (!list || !el) return;
    const top = el.offsetTop - (el.parentElement?.querySelector('.sel-group') ? 28 : 0), bottom = el.offsetTop + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 6); else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 6;
  }, [open, active]);
  useEffect(() => { if (open) setActive(shown.findIndex((o) => !o.disabled)); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (o: SelectOption<T>) => { if (o.disabled) return; onChange(o.value); close(); };
  const move = (dir: 1 | -1, from = active) => {
    for (let k = 1; k <= shown.length; k++) { const i = (from + dir * k + shown.length * 2) % shown.length; if (!shown[i]?.disabled) { setActive(i); return; } }
  };
  const onKey = (e: KeyboardEvent) => {
    if (!open) { if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openMenu(); } return; }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Home': e.preventDefault(); setActive(shown.findIndex((o) => !o.disabled)); break;
      case 'End': e.preventDefault(); setActive(shown.length - 1 - [...shown].reverse().findIndex((o) => !o.disabled)); break;
      case 'Enter': e.preventDefault(); if (shown[active]) pick(shown[active]); break;
      case ' ': if (!canSearch) { e.preventDefault(); if (shown[active]) pick(shown[active]); } break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(); break;
      case 'Tab': close(false); break;
      default:
        if (!canSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey) { // 글자로 건너뛰기
          const now = Date.now(), ty = typed.current; ty.s = now - ty.at > 600 ? e.key.toLowerCase() : ty.s + e.key.toLowerCase(); ty.at = now;
          const i = shown.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(ty.s)); if (i >= 0) setActive(i);
        }
    }
  };

  let lastGroup: string | undefined;
  return (
    <div className={`sel${size === 'sm' ? ' sm' : ''}${className ? ` ${className}` : ''}`}>
      <button ref={btn} id={id} type="button" className={`sel-btn${open ? ' open' : ''}${selected ? '' : ' empty'}`} role="combobox" aria-haspopup="listbox" aria-expanded={open}
              aria-controls={listId} aria-activedescendant={open && active >= 0 ? `${uid}-o${active}` : undefined} aria-label={rest['aria-label']} disabled={disabled}
              onClick={() => (open ? close() : openMenu())} onKeyDown={onKey}>
        {selected?.icon && <span className="sel-ico" aria-hidden="true">{selected.icon}</span>}
        <span className="sel-val">{selected ? selected.label : placeholder}</span>
        <svg className="sel-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && pos && createPortal(
        <div ref={pop} className={`sel-pop${pos.bottom !== undefined ? ' up' : ''}`} style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxH }} onKeyDown={onKey}>
          {canSearch && (
            <div className="sel-search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="검색" aria-label="항목 검색" aria-controls={listId} aria-activedescendant={active >= 0 ? `${uid}-o${active}` : undefined} />
            </div>
          )}
          <ul id={listId} role="listbox" className="sel-list" aria-label={rest['aria-label']}>
            {shown.length === 0 && <li className="sel-empty" role="presentation">{emptyText}</li>}
            {shown.map((o, i) => {
              const head = o.group !== undefined && o.group !== lastGroup ? o.group : null; lastGroup = o.group;
              return (
                <li key={String(o.value)} role="presentation">
                  {head && <div className="sel-group" role="presentation">{head}</div>}
                  <div id={`${uid}-o${i}`} data-i={i} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
                       className={`sel-opt${i === active ? ' act' : ''}${o.value === value ? ' on' : ''}${o.disabled ? ' dis' : ''}`}
                       onPointerEnter={() => !o.disabled && setActive(i)} onClick={() => pick(o)}>
                    {o.icon && <span className="sel-ico" aria-hidden="true">{o.icon}</span>}
                    <span className="sel-txt"><span className="sel-label">{o.label}</span>{o.hint && <span className="sel-hint">{o.hint}</span>}</span>
                    {o.value === value && <svg className="sel-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>, document.body)}
    </div>
  );
}

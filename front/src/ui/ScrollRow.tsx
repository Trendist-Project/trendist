import { useEffect, useRef, useState, type HTMLAttributes, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * 한 줄로만 보이는 가로 슬라이드 줄(정렬 칩 등). 칸이 모자라면 줄바꿈하지 않고 옆으로 밀어 본다.
 * 터치는 손가락으로 밀고, 마우스는 휠(세로 휠도 가로로 바뀜)이나 끌기로 민다. 더 볼 쪽에는 옅은 그림자가 생기고,
 * 선택된 칸(`.active`)은 보이는 자리로 스크롤한다.
 */
export function ScrollRow({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // 안 넘치거나 이미 가로 휠이면 그대로
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('scroll', measure); ro?.disconnect(); };
  }, []);

  // 선택된 칸이 가려져 있으면 보이게(칸 내용이 바뀔 때마다)
  useEffect(() => {
    const el = ref.current;
    const active = el?.querySelector<HTMLElement>('.active');
    if (!el || !active) return;
    const l = active.offsetLeft - el.offsetLeft, r = l + active.offsetWidth;
    if (l < el.scrollLeft) el.scrollLeft = l - 8;
    else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 8;
    measure();
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !ref.current || ref.current.scrollWidth <= ref.current.clientWidth) return;
    drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || !ref.current) return;
      if (Math.abs(ev.clientX - d.x) > 4) d.moved = true;
      if (d.moved) ref.current.scrollLeft = d.left - (ev.clientX - d.x);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const moved = drag.current?.moved;
      drag.current = null;
      if (moved) { // 끌고 놓은 뒤 따라오는 클릭이 칩을 누른 것으로 처리되지 않게
        const stop = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener('click', stop, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', stop, true), 0);
      }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const cls = ['scroll-row', className, edge.left && 'more-left', edge.right && 'more-right'].filter(Boolean).join(' ');
  return <div ref={ref} className={cls} onPointerDown={onPointerDown} {...rest}>{children}</div>;
}

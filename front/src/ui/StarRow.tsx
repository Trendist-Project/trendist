import { useLayoutEffect, useRef, useState } from 'react';

/**
 * 성(★) 표시(4.44): 별을 개수만큼 그대로 그리고, 한 줄에 다 들어가지 않으면 `★×7`처럼 줄여 보인다.
 * 보이지 않는 측정용 글자에 전체 별을 그려 두고 칸 너비와 비교하며, 칸 크기가 바뀌면(패널 크기 조절 포함) 다시 잰다.
 */
export function StarRow({ stars, label }: { stars: number; label: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const full = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);
  const text = '★'.repeat(Math.max(1, stars));

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => { if (box.current && full.current) setCompact(full.current.offsetWidth > box.current.clientWidth); };
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span ref={box} className="mine-stars" role="img" aria-label={label}>
      <span ref={full} className="mine-stars-measure" aria-hidden="true">{text}</span>
      <span aria-hidden="true">{compact ? `★×${Math.max(1, stars)}` : text}</span>
    </span>
  );
}

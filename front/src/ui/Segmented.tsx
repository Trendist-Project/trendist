import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import './select.css';

/** 분할 버튼(라디오 그룹): 선택지가 서너 개일 때 한눈에 보이게 한다. ←→로 옮기면 바로 고른다(roving tabindex). */
export interface SegmentedOption<T extends string | number> { value: T; label: string; icon?: ReactNode; disabled?: boolean }
interface Props<T extends string | number> {
  value: T; options: SegmentedOption<T>[]; onChange(v: T): void; 'aria-label': string; size?: 'sm' | 'md'; full?: boolean; className?: string;
}

export function Segmented<T extends string | number>({ value, options, onChange, size = 'md', full, className, ...rest }: Props<T>) {
  const root = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    for (let k = 1; k <= options.length; k++) {
      const j = (i + dir * k + options.length * 2) % options.length;
      if (!options[j].disabled) { onChange(options[j].value); root.current?.querySelectorAll<HTMLElement>('[role=radio]')[j]?.focus(); return; }
    }
  };
  return (
    <div ref={root} className={`segmented${size === 'sm' ? ' sm' : ''}${full ? ' full' : ''}${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={rest['aria-label']}>
      {options.map((o, i) => (
        <button key={String(o.value)} type="button" role="radio" className="seg-opt" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1}
                disabled={o.disabled} onClick={() => onChange(o.value)} onKeyDown={(e) => onKey(e, i)}>
          {o.icon && <span aria-hidden="true">{o.icon}</span>}{o.label}
        </button>
      ))}
    </div>
  );
}

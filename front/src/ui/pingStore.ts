import { useSyncExternalStore } from 'react';

/**
 * 서버와의 왕복 시간(ms, 부드럽게)을 들고 있는 작은 저장소. 핑은 2초마다 바뀌는데 이 값을 GameScreen의 상태로 두면 화면 전체가 2초마다 다시 그려진다.
 * 이 저장소를 읽는 작은 컴포넌트(PingBadge, PerfHud)만 다시 그려지게 한다.
 */
let value: number | null = null;
const listeners = new Set<() => void>();

export function setPing(next: number | null | ((prev: number | null) => number | null)) {
  const v = typeof next === 'function' ? next(value) : next;
  if (v === value) return;
  value = v;
  listeners.forEach((l) => l());
}

export function usePing(): number | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => value);
}

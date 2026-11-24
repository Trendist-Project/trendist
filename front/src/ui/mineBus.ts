import type { MyKeyword } from '../api/types';

/**
 * 구슬 결과가 보관함 목록을 직접 고치게 하는 작은 통로. 구슬을 먹을 때마다 보관함 전체를 서버에서 다시 읽으면(키워드가 수백 개면 무겁다)
 * 느려지므로, 서버가 구슬 결과에 실어 준 키워드 번호·만료 시각으로 목록만 고치고 전체는 1분마다 읽어 맞춘다.
 */
export type MineEvent = { kind: 'gain' | 'renew'; keywordId: number; text: string; state: MyKeyword['state']; trendValue: number; expiresAt: string };

const listeners = new Set<(events: MineEvent[]) => void>();

export const mineBus = {
  /** 한 번에 여러 개를 보낸다(구슬 결과를 모아 보내므로, 받는 쪽이 목록을 한 번에 고칠 수 있다) */
  emit(events: MineEvent[]) { listeners.forEach((l) => l(events)); },
  subscribe(fn: (events: MineEvent[]) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};

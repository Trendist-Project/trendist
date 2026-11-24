import { useSyncExternalStore } from 'react';
import type { RankingEntry } from '../api/types';

/**
 * 실시간 랭킹(리더보드)을 들고 있는 작은 저장소. 서버가 소켓으로 2초마다 보내 주는 값(leaderboard 메시지)을 여기에 넣고,
 * 리더보드 화면은 이 값을 읽는다. 따로 조회(/api/rankings)하지 않아도 되고, 값이 바뀔 때 리더보드만 다시 그려진다.
 */
export interface LeaderboardState { top: RankingEntry[]; me: RankingEntry | null }

let value: LeaderboardState | null = null;
const listeners = new Set<() => void>();

export const getLeaderboard = () => value;

export function setLeaderboard(next: LeaderboardState) {
  value = next;
  listeners.forEach((l) => l());
}

export function useLeaderboard(): LeaderboardState | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => value);
}

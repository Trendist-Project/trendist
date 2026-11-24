import type { ReactNode } from 'react';

/**
 * 관리자 메뉴 구조(13절). 18개를 한 줄로 늘어놓지 않고 하는 일별로 묶는다:
 * 모니터링(지금 상황을 본다) · 커뮤니티(사람과 신고) · 콘텐츠(글·키워드) · 게임 설정(밸런스·화면) · 시스템(연동·이력).
 * 탭 이름(id)은 그대로이고 묶음·아이콘·한 줄 설명만 더했다.
 */
export type Tab = 'dashboard' | 'stats' | 'spectate' | 'users' | 'keywords' | 'ai' | 'add' | 'reports' | 'notices' | 'emergency' | 'guides' | 'share' | 'integrations' | 'skills' | 'monsters' | 'changes' | 'theme' | 'settings';

export interface NavItem { id: Tab; label: string; desc?: string }
export interface NavGroup { title: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { title: '모니터링', items: [
    { id: 'dashboard', label: '대시보드' },
    { id: 'stats', label: '통계', desc: '시간대별·일별 이용 추이' },
    { id: 'spectate', label: '관전', desc: '아레나를 실시간으로 지켜봐요' },
  ] },
  { title: '커뮤니티', items: [
    { id: 'users', label: '사용자', desc: '계정을 찾고 제재·복구를 관리해요' },
    { id: 'reports', label: '신고', desc: '들어온 신고를 확인하고 조치해요' },
  ] },
  { title: '콘텐츠', items: [
    { id: 'keywords', label: '키워드', desc: '키워드를 조회하고 상태를 바꿔요' },
    { id: 'ai', label: 'AI 설명', desc: '키워드 한 줄 설명을 만들고 다듬어요' },
    { id: 'add', label: '일괄 추가·금지', desc: '여러 키워드를 한 번에 추가하거나 막아요' },
    { id: 'notices', label: '공지', desc: '사용자에게 보이는 공지사항' },
    { id: 'emergency', label: '긴급 안내', desc: '게임 화면 맨 위에 흐르는 긴급 문구' },
    { id: 'guides', label: '가이드', desc: '게임 가이드·FAQ 글' },
    { id: 'share', label: '공유', desc: '자랑하기 카드·공유 설정' },
  ] },
  { title: '게임 설정', items: [
    { id: 'settings', label: '밸런스 설정', desc: '점수·크기·충돌 같은 수치를 배포 없이 바꿔요' },
    { id: 'skills', label: '스킬', desc: '스킬의 쿨타임·해금 레벨·사용 여부' },
    { id: 'monsters', label: '몬스터', desc: '보스를 소환하고 수치를 고쳐요' },
    { id: 'theme', label: '배경·조명·날씨', desc: '아레나 풍경과 시간대 조명, 날씨를 정해요' },
  ] },
  { title: '시스템', items: [
    { id: 'integrations', label: '연동', desc: '외부 서비스 연결 상태' },
    { id: 'changes', label: '변경 이력', desc: '누가 언제 무엇을 바꿨는지, 되돌리기' },
  ] },
];

export const ALL_ITEMS = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));
export const isTab = (v: string): v is Tab => ALL_ITEMS.some((i) => i.id === v);

// 24px 선 아이콘(stroke = currentColor)
const P = (d: string) => <path d={d} />;
const ICONS: Record<string, ReactNode> = {
  dashboard: <>{P('M4 4h6.5v7H4zM13.5 4H20v4h-6.5zM13.5 11H20v9h-6.5zM4 14h6.5v6H4z')}</>,
  stats: <>{P('M5 20V11M12 20V4M19 20v-6')}</>,
  spectate: <>{P('M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z')}<circle cx="12" cy="12" r="3" /></>,
  users: <>{P('M16 19v-1.2a3.8 3.8 0 00-3.8-3.8H7.8A3.8 3.8 0 004 17.8V19')}<circle cx="10" cy="7.5" r="3.2" />{P('M20 19v-1.2a3.8 3.8 0 00-2.6-3.6M15.6 4.5a3.2 3.2 0 010 6')}</>,
  reports: <>{P('M5 21V4M5 4h11.5l-2.2 4 2.2 4H5')}</>,
  keywords: <>{P('M9.5 3.5L8 20.5M16 3.5l-1.5 17M4 8.5h16.5M3.5 15.5H20')}</>,
  ai: <>{P('M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z')}</>,
  add: <>{P('M4 6.5h11M4 12h7M4 17.5h7M17 13.5v7M13.5 17h7')}</>,
  notices: <>{P('M6 9a6 6 0 1112 0c0 5.5 2 7 2 7H4s2-1.5 2-7M10 20a2 2 0 004 0')}</>,
  emergency: <>{P('M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.5h.01')}</>,
  guides: <>{P('M4 5.5A2.5 2.5 0 016.5 3H19v15.5H6.5A2.5 2.5 0 004 21zM4 19.5A2.5 2.5 0 016.5 17H19')}</>,
  share: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" />{P('M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6')}</>,
  integrations: <>{P('M9 3v5M15 3v5M6.5 8h11v3.5a5.5 5.5 0 01-11 0zM12 17v4')}</>,
  skills: <>{P('M13.5 2.5L4.5 14H11l-1 7.5 9-11.5h-6.5z')}</>,
  monsters: <>{P('M12 3a8 8 0 00-8 8c0 3 1.4 4.6 3 5.6V20h10v-3.4c1.6-1 3-2.600 3-5.600a8 8 0 00-8-8zM9 11.5h.01M15 11.5h.01M10 16v2M14 16v2')}</>,
  theme: <>{P('M3.5 5h17v14h-17zM3.5 16l5-5 4 4 3-3 5 5')}<circle cx="8.5" cy="9" r="1.2" /></>,
  settings: <>{P('M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1M15 4v5M9 9.5v5M17 15v5')}</>,
  changes: <>{P('M3.5 12a8.500 8.500 0 102.600-6.100L3.500 8.500M3.500 3.500v5h5M12 7.500V12l3 2')}</>,
  menu: <>{P('M4 6.5h16M4 12h16M4 17.5h16')}</>,
  close: <>{P('M6 6l12 12M18 6L6 18')}</>,
  game: <>{P('M10 4.5H5.5v14h13V14M14 4.5h5.500V10M19.500 4.500L11 13')}</>,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICONS[name] ?? null}</svg>;
}

import { api } from '../api/client';
import type { UiPrefsResponse } from '../api/types';
import { autoFullscreenPref } from '../fullscreen';
import { subscribePrefs } from '../prefsBus';
import { loadChatView, loadHelpPref, loadLeaderboardPref, loadMinimapPref, loadSideHidden, loadSideHeight, loadSideWidth } from './gamePrefs';

export type UiPrefs = Omit<UiPrefsResponse, 'saved'>;

/** 이 브라우저의 현재 UI 선택 */
function snapshot(): UiPrefs {
  return { minimap: loadMinimapPref(), leaderboard: loadLeaderboardPref(), chat: loadChatView(), help: loadHelpPref(), autoFullscreen: autoFullscreenPref(),
    sideHidden: loadSideHidden(), sideWidth: loadSideWidth(), sideHeight: loadSideHeight() };
}
const key = (p: UiPrefs) => JSON.stringify([p.minimap, p.leaderboard, p.chat, p.help, p.autoFullscreen, p.sideHidden, p.sideWidth, p.sideHeight]);

/**
 * 게임 화면 UI 선택을 계정에 맞춘다(소리 동기화와 같은 방식). 열리면 서버 값을 받아 apply 로 적용하고(서버 값 우선),
 * 저장된 적이 없으면 이 브라우저 값을 올린다. 그 뒤 바뀔 때마다 0.7초 디바운스로 저장한다. 네트워크 실패는 조용히 무시한다.
 * 마지막으로 동기화한 값과 같으면 저장하지 않아서, 적용 -> 화면 상태 저장 -> 알림 -> 재저장 루프가 생기지 않는다.
 */
export function startUiSync(apply: (p: UiPrefs) => void): () => void {
  let alive = true, touched = false;
  let last = '';
  let timer = 0;
  const initial = key(snapshot());
  const push = () => {
    const s = snapshot(); const k = key(s);
    if (k === last) return;
    api.saveUiSettings(s).then(() => { last = k; }).catch(() => { /* 다음 변경 때 다시 */ });
  };
  const off = subscribePrefs(() => {
    const k = key(snapshot());
    if (k === last || (!touched && k === initial)) return; // 변한 게 없는 알림(화면이 켜질 때 값을 다시 저장하는 것 등)
    touched = true;
    window.clearTimeout(timer); timer = window.setTimeout(push, 700);
  });
  api.uiSettings().then((r) => {
    if (!alive) return;
    if (!r.saved || touched) { if (!touched) push(); return; }
    const { saved, ...p } = r; void saved;
    last = key(p);
    apply(p);
  }).catch(() => { /* 오프라인이면 이 브라우저 값 그대로 */ });
  return () => { alive = false; off(); window.clearTimeout(timer); };
}

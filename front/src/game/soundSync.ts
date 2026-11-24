import { api } from '../api/client';
import { setBgm, setSfx, setVolume, soundState, subscribeSound } from './sound';

/**
 * 소리 설정을 계정에 맞춘다(4.39). 게임 화면이 열리면 서버에 저장된 값을 받아 적용하고(서버 값이 우선),
 * 저장된 적이 없으면 이 브라우저의 값을 올려 보낸다. 그 뒤 바꿀 때마다(슬라이더는 멈춘 뒤 0.7초에 한 번) 저장한다.
 * 네트워크가 안 되면 조용히 넘어가고 이 브라우저에는 계속 남는다(localStorage).
 */
export function startSoundSync(): () => void {
  let alive = true, applying = false, touched = false;
  let timer = 0;
  const push = () => {
    const s = soundState();
    api.saveSoundSettings({ sfx: s.sfx, bgm: s.bgm, master: s.master, sfxVolume: s.sfxVol, bgmVolume: s.bgmVol }).catch(() => { /* 다음 변경 때 다시 */ });
  };
  const off = subscribeSound(() => {
    if (applying) return; // 서버 값을 적용하는 중의 알림은 다시 저장하지 않는다
    touched = true;
    window.clearTimeout(timer); timer = window.setTimeout(push, 700);
  });
  api.soundSettings().then((r) => {
    if (!alive) return;
    if (!r.saved || touched) { if (!touched) push(); return; } // 저장한 적이 없으면 이 브라우저의 값을 올린다(받는 사이 직접 바꿨다면 그 변경 저장이 이미 예약돼 있다)
    applying = true;
    try { setVolume('master', r.master); setVolume('sfx', r.sfxVolume); setVolume('bgm', r.bgmVolume); setSfx(r.sfx); setBgm(r.bgm); } finally { applying = false; }
  }).catch(() => { /* 오프라인이면 이 브라우저 값 그대로 */ });
  return () => { alive = false; off(); window.clearTimeout(timer); };
}

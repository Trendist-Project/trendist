/** 게임 화면 UI 선택(gamePrefs·fullscreen)이 바뀌었음을 알리는 아주 작은 pub/sub. uiSync 가 구독한다. */
const subs = new Set<() => void>();
export const subscribePrefs = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };
export const notifyPrefs = () => { subs.forEach((f) => f()); };

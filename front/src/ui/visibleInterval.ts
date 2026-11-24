/**
 * 화면(탭)이 보일 때만 도는 주기 작업. 탭이 가려지면 멈추고, 다시 보이는 순간 한 번 바로 실행한 뒤 이어서 돈다.
 * 보이지 않는 탭이 서버를 계속 조회하거나 화면을 다시 그리는 일을 막는다. 돌려주는 함수를 부르면 정리된다.
 */
export function visibleInterval(fn: () => void, ms: number): () => void {
  let id = 0;
  const start = () => { if (!id) id = window.setInterval(fn, ms); };
  const stop = () => { if (id) { window.clearInterval(id); id = 0; } };
  const onVisibility = () => { if (document.hidden) stop(); else { fn(); start(); } };
  document.addEventListener('visibilitychange', onVisibility);
  if (!document.hidden) start();
  return () => { document.removeEventListener('visibilitychange', onVisibility); stop(); };
}

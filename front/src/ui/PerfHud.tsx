import { useEffect, useState } from 'react';
import { wsStats } from '../game/perfStats';

/**
 * 성능 점검 표시(개발용). 주소 끝에 ?perf=1을 붙이면(또는 localStorage trendist.perfHud=1) 화면 왼쪽 위에 1초마다 갱신되는 숫자가 뜬다.
 * 렉이 서버(틱·DB) 탓인지 브라우저(그리기·메시지 처리) 탓인지 가르려는 것이다.
 *  - 프레임: 평균 FPS, 가장 긴 프레임(ms), 50ms를 넘긴 프레임 수. 긴 프레임이 잦으면 브라우저가 바쁜 것이다
 *  - 긴 작업: 메인 스레드를 50ms 넘게 붙든 작업의 수와 합계(PerformanceObserver longtask)
 *  - 메시지: 1초당 스냅샷(이진)·문자 메시지 수와 KB. 갑자기 몰려오면 서버가 밀린 것이 한꺼번에 도착하는 것이다
 *  - 핑: 서버와의 왕복. 브라우저가 바쁘면 서버가 한가해도 핑이 커 보인다
 */
export const perfHudEnabled = () => {
  try { return new URLSearchParams(location.search).get('perf') === '1' || localStorage.getItem('trendist.perfHud') === '1'; } catch { return false; }
};

export function PerfHud({ pingMs }: { pingMs: number | null }) {
  const [line, setLine] = useState('측정 중…');
  useEffect(() => {
    let frames = 0, maxFrame = 0, slowFrames = 0, last = performance.now(), raf = 0;
    let longCount = 0, longMs = 0;
    const tick = (now: number) => {
      const dt = now - last; last = now;
      frames++; if (dt > maxFrame) maxFrame = dt; if (dt > 50) slowFrames++;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    let po: PerformanceObserver | null = null;
    try {
      po = new PerformanceObserver((list) => { for (const e of list.getEntries()) { longCount++; longMs += e.duration; } });
      po.observe({ entryTypes: ['longtask'] });
    } catch { /* 지원하지 않는 브라우저 */ }
    let prev = { ...wsStats };
    const id = window.setInterval(() => {
      const snap = wsStats.snapshots - prev.snapshots, txt = wsStats.texts - prev.texts, kb = (wsStats.bytes - prev.bytes) / 1024;
      prev = { ...wsStats };
      const text = `FPS ${frames} · 최장 프레임 ${maxFrame.toFixed(0)}ms (50ms↑ ${slowFrames}) · 긴 작업 ${longCount}회 ${longMs.toFixed(0)}ms · 메시지 ${snap}+${txt}/s ${kb.toFixed(0)}KB/s`;
      setLine(text);
      if (maxFrame > 100 || longMs > 200) console.warn('[perf]', text);
      frames = 0; maxFrame = 0; slowFrames = 0; longCount = 0; longMs = 0;
    }, 1000);
    return () => { cancelAnimationFrame(raf); window.clearInterval(id); po?.disconnect(); };
  }, []);
  return (
    <div style={{ position: 'fixed', left: 6, top: 6, zIndex: 99999, padding: '3px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.7)', color: '#9be7b0', font: '12px/1.4 monospace', pointerEvents: 'none' }}>
      {line} · 핑 {pingMs ?? '-'}ms
    </div>
  );
}

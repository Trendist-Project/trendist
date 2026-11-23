import { useEffect, useState } from 'react';
import { adminApi, type ServerInfo } from '../api/client';

const pad = (n: number) => String(n).padStart(2, '0');

/** 0초부터 센 경과 시간: "3일 04:05:06" (하루 미만이면 "04:05:06") */
export function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hms = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return days > 0 ? `${days}일 ${hms}` : hms;
}

/** 서버가 시작한 시각을 한국 시간으로(마우스를 올리면 보인다) */
function formatStarted(iso: string): string {
  const kst = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}`;
}

/**
 * 서버 가동 시간. 서버가 알려 준 경과 시간에서 이어 1초마다 센다(내 컴퓨터 시계가 틀려도 영향 없음).
 * 서버가 다시 시작되면(배포) 1분마다 다시 읽어 0초부터 새로 센다.
 */
export function ServerUptime() {
  const [data, setData] = useState<{ info: ServerInfo; fetchedAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = () => {
      adminApi.system().then((info) => { if (alive) setData({ info, fetchedAt: Date.now() }); }).catch(() => {});
    };
    load();
    const t = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!data) return null;
  const seconds = (data.info.uptimeMillis + (now - data.fetchedAt)) / 1000;
  return (
    <div className="admin-uptime" role="status" title={`서버 시작 ${formatStarted(data.info.startedAt)}`}>
      <i className="admin-uptime-dot" aria-hidden="true" />
      <span className="admin-uptime-label">가동</span>
      <b className="admin-uptime-time">{formatUptime(seconds)}</b>
    </div>
  );
}

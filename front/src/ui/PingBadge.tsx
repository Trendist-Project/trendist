import { t } from '../i18n';
import { pingQuality } from './gamePrefs';
import { usePing } from './pingStore';

/** 화면 위쪽의 핑 표시. 핑 값이 바뀔 때 이 작은 컴포넌트만 다시 그려진다(GameScreen 전체가 아니라). */
export function PingBadge({ open }: { open: boolean }) {
  const pingMs = usePing();
  if (pingMs === null || !open) return null;
  const q = pingQuality(pingMs);
  return <span className={`hud-ping ping-${q}`} title={t(`gamescreen.ping_${q}`, { ms: pingMs })} aria-label={t(`gamescreen.ping_${q}`, { ms: pingMs })}><i aria-hidden="true" />{pingMs}ms</span>;
}

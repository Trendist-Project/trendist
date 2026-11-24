import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminApi, api, type AdminSetting } from '../api/client';
import { BACKGROUNDS, BG_GROUP_NAMES, type Bg } from '../game/theme/backgrounds';
import { LIGHT_NAMES } from '../game/theme/light';
import { ThemeLayer, WEATHER_NAMES, type ThemeConfig } from '../game/theme/ThemeLayer';
import { successToast } from '../ui/toast';
import { getAdminCountry } from '../api/adminCountry';
import { errMsg } from './format';

/**
 * 아레나 배경·조명·날씨(4.38, 13.3): 세 가지를 따로 고른다. 값은 밸런스 설정(settings)에 저장되어 접속 중인 사용자에게 10분 안에(새로 들어오면 바로) 반영된다.
 * - 배경: 원래 아레나(기본) / 자연 풍경 / 도트 풍경 / 전투장 / 이벤트
 * - 조명: 해와 달의 위치와 그에 따른 색조·그림자·밝기. 현실 시간 자동 또는 낮·노을·밤·새벽 고정이며 어떤 배경에도 얹힌다
 * - 날씨: 끔 / 실제 날씨 / 고정
 * 오른쪽 미리보기는 게임과 같은 그림 코드로 그린다. 저장하지 않은 선택도 바로 보이고, 시각 슬라이더로 하루의 변화를 볼 수 있다.
 */
const KEYS = ['arena_bg', 'arena_light_mode', 'arena_light_fixed', 'arena_weather_mode', 'arena_weather_fixed', 'arena_kr_lat', 'arena_kr_lon', 'arena_global_lat', 'arena_global_lon'] as const;
type Key = (typeof KEYS)[number];
type Form = Record<Key, string>;
const LIGHT_MODES = ['끔 (조명 없음)', '현실 시간 자동 (서버 위치의 해·달)', '고정 시간대'];
const WEATHER_MODES = ['끔', '실제 날씨 (나라 위치 기준)', '고정 날씨'];

function fromSettings(list: AdminSetting[]): Form {
  const f = {} as Form;
  for (const k of KEYS) f[k] = list.find((s) => s.name === k)?.value ?? '';
  return f;
}

export function ThemeTab() {
  const country = getAdminCountry();
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<ThemeConfig | null>(null); // 서버가 지금 주는 값(실제 날씨 포함)
  const [hour, setHour] = useState<number | null>(null); // 미리보기 시각(null = 지금)
  const [previewWeather, setPreviewWeather] = useState<number | null>(null); // 미리보기 날씨(null = 설정대로)

  const load = useCallback(() => {
    adminApi.settings().then((l) => { const f = fromSettings(l); setSaved(f); setForm(f); setError(null); }).catch((e) => setError(errMsg(e)));
    api.arenaTheme(country).then(setLive).catch(() => setLive(null));
  }, [country]);
  useEffect(load, [load]);

  const dirty = !!form && !!saved && KEYS.some((k) => form[k] !== saved[k]);
  const num = (k: Key, d: number) => { const v = Number(form?.[k]); return Number.isFinite(v) ? v : d; };
  const lat = country === 'KR' ? num('arena_kr_lat', 37.5665) : num('arena_global_lat', 51.5);
  const lon = country === 'KR' ? num('arena_kr_lon', 126.978) : num('arena_global_lon', 0);

  /** 미리보기에 쓰는 설정: 저장하지 않은 선택을 그대로 쓰고, 날씨는 고르면 그것을, 아니면 설정대로(실제 날씨면 서버가 지금 주는 값) */
  const cfg: ThemeConfig | null = useMemo(() => {
    if (!form) return null;
    const wm = num('arena_weather_mode', 0);
    const settingWeather = wm === 2 ? num('arena_weather_fixed', 0) : wm === 1 ? live?.weather ?? 0 : 0;
    return { bg: num('arena_bg', 0), lightMode: num('arena_light_mode', 0), lightFixed: num('arena_light_fixed', 1), weatherMode: wm, weather: previewWeather ?? settingWeather, lat, lon, nowMs: Date.now() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, live, previewWeather, lat, lon]);

  const set = (k: Key, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save() {
    if (!form || !saved) return;
    setBusy(true);
    try {
      for (const k of KEYS) if (form[k] !== saved[k]) await adminApi.updateSetting(k, form[k]);
      successToast('배경·날씨 설정을 저장했어요'); load();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!form) return <section className="admin-panel"><p className="muted">{error ?? '불러오는 중…'}</p></section>;
  const lmode = num('arena_light_mode', 0), wmode = num('arena_weather_mode', 0);

  return (
    <section className="admin-panel th">
      <p className="muted small">게임 아레나의 배경과 날씨를 정해요. 저장하면 접속 중인 사용자에게는 10분 안에, 새로 들어오는 사용자에게는 바로 적용돼요.
        <b> 기본 배경</b>이면 지금까지의 어두운 바닥 그대로예요. 위치(위도·경도)는 해가 뜨고 지는 시각과 실제 날씨를 정하는 기준이에요.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="th-grid">
        <div className="admin-card th-form">
          <h2>배경</h2>
          <label>풍경
            <select value={form.arena_bg} onChange={(e) => set('arena_bg', e.target.value)}>
              <option value={0}>기본 아레나 (원래 모습)</option>
              {(Object.keys(BG_GROUP_NAMES) as Bg['group'][]).map((g) => (
                <optgroup key={g} label={BG_GROUP_NAMES[g]}>
                  {BACKGROUNDS.filter((b) => b.group === g).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <h2>조명</h2>
          <label>방식
            <select value={form.arena_light_mode} onChange={(e) => set('arena_light_mode', e.target.value)}>
              {LIGHT_MODES.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </label>
          {lmode === 2 && (
            <label>시간대
              <select value={form.arena_light_fixed} onChange={(e) => set('arena_light_fixed', e.target.value)}>
                {Object.entries(LIGHT_NAMES).map(([n, name]) => <option key={n} value={n}>{name}</option>)}
              </select>
            </label>
          )}
          <p className="muted small">조명은 해와 달의 위치를 정하고, 그에 따라 색조·밝기·그림자가 바뀌어요. 어떤 배경 위에도 적용돼요.</p>
          <h2>날씨</h2>
          <label>모드
            <select value={form.arena_weather_mode} onChange={(e) => set('arena_weather_mode', e.target.value)}>
              {WEATHER_MODES.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </label>
          {wmode === 2 && (
            <label>고정 날씨
              <select value={form.arena_weather_fixed} onChange={(e) => set('arena_weather_fixed', e.target.value)}>
                {WEATHER_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
              </select>
            </label>
          )}
          {wmode === 1 && <p className="muted small">지금 {country} 서버 위치의 실제 날씨: <b>{live ? WEATHER_NAMES[live.weather] ?? '-' : '확인 못 함'}</b>{live && live.weatherMode !== 1 && ' (저장하면 반영)'}</p>}
          <h2>위치 ({country})</h2>
          <div className="th-geo">
            <label>위도<input type="number" step="0.0001" min={-90} max={90} value={form[country === 'KR' ? 'arena_kr_lat' : 'arena_global_lat']} onChange={(e) => set(country === 'KR' ? 'arena_kr_lat' : 'arena_global_lat', e.target.value)} /></label>
            <label>경도<input type="number" step="0.0001" min={-180} max={180} value={form[country === 'KR' ? 'arena_kr_lon' : 'arena_global_lon']} onChange={(e) => set(country === 'KR' ? 'arena_kr_lon' : 'arena_global_lon', e.target.value)} /></label>
          </div>
          <p className="muted small">나라를 바꾸려면 오른쪽 위의 나라 선택을 쓰세요. 다른 나라의 위치도 이 화면에서 같은 방법으로 바꿀 수 있어요.</p>
          <div className="admin-actions">
            <button className="primary" disabled={!dirty || busy} onClick={save}>{busy ? '저장하는 중…' : '저장'}</button>
            <button disabled={!dirty || busy} onClick={() => setForm(saved)}>되돌리기</button>
          </div>
        </div>

        <div className="admin-card th-preview">
          <h2>미리보기</h2>
          {cfg && <ThemePreview cfg={cfg} hour={hour} />}
          <div className="th-tools">
            <label>시각 {lmode === 1 ? '' : <span className="muted small">(조명이 "현실 시간 자동"일 때만 바뀌어요)</span>}
              <input type="range" min={0} max={24} step={0.25} value={hour ?? new Date().getHours()} onChange={(e) => setHour(Number(e.target.value))} disabled={lmode !== 1} />
              <span className="small">{hour === null ? '지금' : `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`}</span>
              {hour !== null && <button type="button" className="link-btn" onClick={() => setHour(null)}>지금으로</button>}
            </label>
            <label>날씨 보기
              <select value={previewWeather ?? ''} onChange={(e) => setPreviewWeather(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">설정대로</option>
                {WEATHER_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 게임과 같은 ThemeLayer로 그린 작은 아레나. 가운데에 예시 원 몇 개를 둔다 */
function ThemePreview({ cfg, hour }: { cfg: ThemeConfig; hour: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const layer = useRef<ThemeLayer | null>(null);
  if (!layer.current) layer.current = new ThemeLayer(false);
  useEffect(() => { layer.current!.setConfig(cfg); }, [cfg]);
  useEffect(() => { layer.current!.setPreviewHour(hour); }, [hour]);
  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext('2d')!;
    let raf = 0;
    const frame = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const L = layer.current!, zoom = 0.5, half = 520;
      ctx.fillStyle = '#0b0f17'; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(zoom, zoom);
      if (!L.drawFloor(ctx, half, { x: 0, y: 0 }, zoom, w, h, now)) { ctx.fillStyle = '#1f2a37'; ctx.fillRect(-half, -half, half * 2, half * 2); }
      ctx.strokeStyle = L.gridColor ?? 'rgba(220,230,255,0.15)'; ctx.lineWidth = 1 / zoom; ctx.beginPath();
      for (let g = -half; g <= half; g += 50) { ctx.moveTo(g, -half); ctx.lineTo(g, half); ctx.moveTo(-half, g); ctx.lineTo(half, g); }
      ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(zoom, zoom);
      for (const [x, y, r, c] of [[-120, 20, 70, '#4aa3ff'], [110, -40, 46, '#ff7a7a'], [40, 120, 30, '#ffd166']] as const) {
        const sh = L.shadow(); ctx.fillStyle = `rgba(0,0,0,${sh ? sh.a : 0.28})`; ctx.beginPath(); ctx.arc(x + (sh ? sh.dx * r : 0), y + (sh ? sh.dy * r : r * 0.05), r + 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = c; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
      L.drawOverlay(ctx, w, h, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="th-canvas" aria-label="아레나 배경 미리보기" />;
}

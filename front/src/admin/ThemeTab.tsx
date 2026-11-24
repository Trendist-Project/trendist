import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { adminApi, api, type AdminSetting } from '../api/client';
import { BACKGROUNDS, BG_GROUP_NAMES, bgOf, DEFAULT_LOOK, type Bg } from '../game/theme/backgrounds';
import { LIGHT_NAMES } from '../game/theme/light';
import { solar } from '../game/theme/sun';
import { ThemeLayer, WEATHER_NAMES, type ThemeConfig } from '../game/theme/ThemeLayer';
import { rgb } from '../game/theme/look';
import { Select, type SelectOption } from '../ui/Select';
import { Segmented } from '../ui/Segmented';
import { successToast } from '../ui/toast';
import { getAdminCountry } from '../api/adminCountry';
import { errMsg } from './format';

/**
 * 아레나 배경·조명·날씨(4.38, 13.3): 세 가지를 따로 고른다. 값은 밸런스 설정(settings)에 저장되어 접속 중인 사용자에게 10분 안에(새로 들어오면 바로) 반영된다.
 * - 풍경: 원래 아레나 / 자연 / 도트 / 전투장 / 이벤트. 카드마다 게임과 같은 그림 코드로 그린 썸네일이고, 고른 조명·시각이 그대로 반영된다
 * - 조명: 해와 달의 위치와 그에 따른 색조·그림자·밝기(현실 시간 자동 또는 낮·노을·밤·새벽 고정)
 * - 날씨: 끔 / 실제 날씨 / 고정
 * 오른쪽 미리보기는 저장하지 않은 선택도 바로 보여 주고, 시각 슬라이더로 하루의 변화를 볼 수 있다.
 */
const KEYS = ['arena_bg', 'arena_light_mode', 'arena_light_fixed', 'arena_weather_mode', 'arena_weather_fixed', 'arena_kr_lat', 'arena_kr_lon', 'arena_global_lat', 'arena_global_lon'] as const;
type Key = (typeof KEYS)[number];
type Form = Record<Key, string>;
const LABEL: Record<Key, string> = { arena_bg: '풍경', arena_light_mode: '조명 방식', arena_light_fixed: '고정 시간대', arena_weather_mode: '날씨 방식', arena_weather_fixed: '고정 날씨', arena_kr_lat: '한국 위도', arena_kr_lon: '한국 경도', arena_global_lat: '글로벌 위도', arena_global_lon: '글로벌 경도' };

const LIGHT_ICON: Record<number, string> = { 1: '☀️', 2: '🌇', 3: '🌙', 4: '🌅' };
const WEATHER_ICON = ['☀️', '⛅', '🌧️', '❄️', '🌫️', '⛈️'];
const CITIES: { name: string; lat: number; lon: number; group: string }[] = [
  { group: '한국', name: '서울', lat: 37.5665, lon: 126.978 }, { group: '한국', name: '부산', lat: 35.1796, lon: 129.0756 }, { group: '한국', name: '제주', lat: 33.4996, lon: 126.5312 },
  { group: '세계', name: '워싱턴 D.C. (미국 수도)', lat: 38.9072, lon: -77.0369 }, { group: '세계', name: '뉴욕', lat: 40.7128, lon: -74.006 }, { group: '세계', name: '로스앤젤레스', lat: 34.0522, lon: -118.2437 },
  { group: '세계', name: '런던', lat: 51.5072, lon: -0.1276 }, { group: '세계', name: '파리', lat: 48.8566, lon: 2.3522 }, { group: '세계', name: '도쿄', lat: 35.6762, lon: 139.6503 },
  { group: '세계', name: '시드니', lat: -33.8688, lon: 151.2093 }, { group: '세계', name: '상파울루', lat: -23.5505, lon: -46.6333 }, { group: '세계', name: '뭄바이', lat: 19.076, lon: 72.8777 },
];

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
  const [group, setGroup] = useState<'all' | Bg['group'] | 'default'>('all');

  const load = useCallback(() => {
    adminApi.settings().then((l) => { const f = fromSettings(l); setSaved(f); setForm(f); setError(null); }).catch((e) => setError(errMsg(e)));
    api.arenaTheme(country).then(setLive).catch(() => setLive(null));
  }, [country]);
  useEffect(load, [load]);

  const dirtyKeys = form && saved ? KEYS.filter((k) => form[k] !== saved[k]) : [];
  const num = (k: Key, d: number) => { const v = Number(form?.[k]); return Number.isFinite(v) && form?.[k] !== '' ? v : d; };
  const latKey: Key = country === 'KR' ? 'arena_kr_lat' : 'arena_global_lat', lonKey: Key = country === 'KR' ? 'arena_kr_lon' : 'arena_global_lon';
  const lat = num(latKey, country === 'KR' ? 37.5665 : 38.9072), lon = num(lonKey, country === 'KR' ? 126.978 : -77.0369);
  const set = (k: Key, v: string | number) => setForm((f) => (f ? { ...f, [k]: String(v) } : f));

  const bgId = num('arena_bg', 0), lmode = num('arena_light_mode', 1), lfixed = num('arena_light_fixed', 1), wmode = num('arena_weather_mode', 1), wfixed = num('arena_weather_fixed', 0);
  /** 미리보기·썸네일에 쓰는 설정: 저장하지 않은 선택을 그대로 쓰고, 날씨는 고르면 그것을, 아니면 설정대로(실제 날씨면 서버가 지금 주는 값) */
  const cfg: ThemeConfig | null = useMemo(() => {
    if (!form) return null;
    const settingWeather = wmode === 2 ? wfixed : wmode === 1 ? live?.weather ?? 0 : 0;
    return { bg: bgId, lightMode: lmode, lightFixed: lfixed, weatherMode: wmode, weather: previewWeather ?? settingWeather, lat, lon, nowMs: Date.now() };
  }, [form, live, previewWeather, bgId, lmode, lfixed, wmode, wfixed, lat, lon]);

  async function save() {
    if (!form || !saved) return;
    setBusy(true);
    try {
      for (const k of dirtyKeys) await adminApi.updateSetting(k, form[k]);
      successToast('배경·조명·날씨 설정을 저장했어요'); load();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!form || !cfg) return <section className="admin-panel"><p className="muted">{error ?? '불러오는 중…'}</p></section>;

  const sun = solar(lat, lon, Date.now());
  const phase = sun.alt > 12 ? '낮' : sun.alt > -4 ? (sun.morning ? '새벽·아침' : '노을') : '밤';
  const cityName = CITIES.find((c) => Math.abs(c.lat - lat) < 0.0005 && Math.abs(c.lon - lon) < 0.0005)?.name ?? null;
  const bgName = bgId === 0 ? '원래 아레나' : BACKGROUNDS.find((b) => b.id === bgId)?.name ?? `#${bgId}`;
  const weatherNow = wmode === 0 ? '끔' : wmode === 2 ? `고정 · ${WEATHER_NAMES[wfixed] ?? '-'}` : `실제 · ${live ? WEATHER_NAMES[live.weather] ?? '-' : '확인 못 함'}`;
  const lightNow = lmode === 0 ? '끔' : lmode === 2 ? `고정 · ${LIGHT_NAMES[lfixed] ?? '-'}` : '현실 시간 자동';

  return (
    <section className="admin-panel th">
      {error && <p className="error" role="alert">{error}</p>}
      <div className="th-grid">
        <div className="th-col">
          <Card title="풍경" desc="아레나 바닥과 둘레 장식을 골라요. 카드는 지금 고른 조명을 반영해서 보여 줘요.">
            <Segmented<string> size="sm" aria-label="풍경 분류" value={group} onChange={(g) => setGroup(g as typeof group)}
                       options={[{ value: 'all', label: '전체' }, { value: 'default', label: '기본' }, ...(Object.keys(BG_GROUP_NAMES) as Bg['group'][]).map((g) => ({ value: g, label: BG_GROUP_NAMES[g] }))]} />
            <BgGallery cfg={cfg} hour={hour} group={group} value={bgId} onPick={(id) => set('arena_bg', id)} />
          </Card>

          <Card title="조명" desc="해와 달의 위치를 정하고, 그에 따라 색조·밝기·그림자가 바뀌어요. 어떤 풍경 위에도 적용돼요.">
            <Segmented aria-label="조명 방식" value={lmode} onChange={(v) => set('arena_light_mode', v)}
                       options={[{ value: 0, label: '끔' }, { value: 1, label: '현실 시간 자동' }, { value: 2, label: '고정 시간대' }]} />
            {lmode === 1 && <p className="th-note"><b>{cityName ?? `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`}</b> 기준 지금은 <b>{phase}</b> (해 고도 {sun.alt >= 0 ? '+' : ''}{sun.alt.toFixed(0)}°)이에요. 시간이 흐르면 자연스럽게 바뀌어요.</p>}
            {lmode === 2 && (
              <Segmented aria-label="고정 시간대" value={lfixed} onChange={(v) => set('arena_light_fixed', v)}
                         options={Object.entries(LIGHT_NAMES).map(([n, name]) => ({ value: Number(n), label: name, icon: LIGHT_ICON[Number(n)] }))} />
            )}
            {lmode === 0 && <p className="th-note">조명을 끄면 풍경 그대로의 밝기로 보여요.</p>}
          </Card>

          <Card title="날씨" desc="풍경과 조명 위에 겹쳐서 보여요.">
            <Segmented aria-label="날씨 방식" value={wmode} onChange={(v) => set('arena_weather_mode', v)}
                       options={[{ value: 0, label: '끔' }, { value: 1, label: '실제 날씨' }, { value: 2, label: '고정 날씨' }]} />
            {wmode === 1 && <p className="th-note">{cityName ?? '서버 위치'}의 지금 날씨: <b>{live ? `${WEATHER_ICON[live.weather] ?? ''} ${WEATHER_NAMES[live.weather] ?? '-'}` : '확인 못 함'}</b> · 15분마다 바뀌어요.</p>}
            {wmode === 2 && (
              <Segmented aria-label="고정 날씨" value={wfixed} onChange={(v) => set('arena_weather_fixed', v)}
                         options={WEATHER_NAMES.map((n, i) => ({ value: i, label: n, icon: WEATHER_ICON[i] }))} />
            )}
          </Card>

          <Card title={`기준 위치 · ${country === 'KR' ? '한국' : '글로벌'} 서버`} desc="해가 뜨고 지는 시각과 실제 날씨를 정하는 위치예요. 위쪽 오른편의 서버 선택으로 다른 나라 위치도 바꿀 수 있어요.">
            <div className="th-geo">
              <label className="th-field">도시로 채우기
                <Select<string> value={cityName} placeholder="직접 입력" menuWidth="auto" aria-label="도시 선택"
                                options={CITIES.map((c): SelectOption<string> => ({ value: c.name, label: c.name, group: c.group, hint: `${c.lat.toFixed(2)}°, ${c.lon.toFixed(2)}°` }))}
                                onChange={(n) => { const c = CITIES.find((x) => x.name === n); if (c) { set(latKey, c.lat); set(lonKey, c.lon); } }} />
              </label>
              <label className="th-field">위도 (°)
                <input type="number" step="0.0001" min={-90} max={90} value={form[latKey]} onChange={(e) => set(latKey, e.target.value)} />
              </label>
              <label className="th-field">경도 (°)
                <input type="number" step="0.0001" min={-180} max={180} value={form[lonKey]} onChange={(e) => set(lonKey, e.target.value)} />
              </label>
            </div>
          </Card>
        </div>

        <aside className="th-side">
          <div className="admin-card th-preview">
            <div className="th-preview-head"><h2>미리보기</h2><span className="muted small">저장 전 선택도 바로 보여요</span></div>
            <ThemePreview cfg={cfg} hour={hour} />
            <dl className="th-now">
              <div><dt>풍경</dt><dd>{bgName}</dd></div>
              <div><dt>조명</dt><dd>{lightNow}</dd></div>
              <div><dt>날씨</dt><dd>{weatherNow}</dd></div>
            </dl>
            <div className="th-tools">
              <label className="th-field">시각 {lmode !== 1 && <span className="muted small">(조명이 "현실 시간 자동"일 때)</span>}
                <span className="th-slider">
                  <input type="range" min={0} max={24} step={0.25} value={hour ?? new Date().getHours() + new Date().getMinutes() / 60} onChange={(e) => setHour(Number(e.target.value))} disabled={lmode !== 1} aria-label="미리보기 시각" />
                  <output>{hour === null ? '지금' : `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`}</output>
                  {hour !== null && <button type="button" className="link-btn" onClick={() => setHour(null)}>지금으로</button>}
                </span>
              </label>
              <label className="th-field">날씨 보기
                <Select<number | ''> size="sm" value={previewWeather ?? ''} aria-label="미리볼 날씨" onChange={(v) => setPreviewWeather(v === '' ? null : v)}
                                     options={[{ value: '', label: '설정대로' }, ...WEATHER_NAMES.map((n, i) => ({ value: i as number | '', label: n, icon: WEATHER_ICON[i] }))]} />
              </label>
            </div>
          </div>
        </aside>
      </div>

      {dirtyKeys.length > 0 && (
        <div className="th-savebar" role="region" aria-label="저장 확인">
          <span className="th-savebar-msg"><b>{dirtyKeys.length}개</b> 바뀜 · {dirtyKeys.map((k) => LABEL[k]).join(', ')}</span>
          <button type="button" disabled={busy} onClick={() => setForm(saved)}>되돌리기</button>
          <button type="button" className="primary" disabled={busy} onClick={save}>{busy ? '저장하는 중…' : '저장'}</button>
        </div>
      )}
    </section>
  );
}

function Card({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="admin-card th-card">
      <div className="th-card-head"><h2>{title}</h2>{desc && <p>{desc}</p>}</div>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ 풍경 갤러리

const GROUP_CHIP: Record<string, string> = { default: '기본', nature: '자연', pixel: '도트', arena: '전투장', event: '이벤트' };

function BgGallery({ cfg, hour, group, value, onPick }: { cfg: ThemeConfig; hour: number | null; group: string; value: number; onPick(id: number): void }) {
  const items = useMemo(() => [{ id: 0, name: '원래 아레나', group: 'default' as const }, ...BACKGROUNDS.map((b) => ({ id: b.id, name: b.name, group: b.group }))].filter((b) => group === 'all' || b.group === group), [group]);
  return (
    <div className="th-gallery" role="radiogroup" aria-label="풍경">
      {items.map((b, i) => (
        <button key={b.id} type="button" role="radio" aria-checked={value === b.id} className={`th-bg${value === b.id ? ' on' : ''}`} onClick={() => onPick(b.id)}>
          <Thumb cfg={{ ...cfg, bg: b.id, weather: 0, weatherMode: 0 }} hour={hour} delay={i * 30} />
          <span className="th-bg-name">{b.name}</span>
          <span className={`th-bg-chip g-${b.group}`}>{GROUP_CHIP[b.group]}</span>
          {value === b.id && <span className="th-bg-check" aria-hidden="true">✓</span>}
        </button>
      ))}
    </div>
  );
}

/** 풍경 썸네일: 아레나 한 귀퉁이(바닥과 둘레 장식이 함께 보이게)를 한 번만 그린다. 조명·시각이 바뀌면 다시 그린다 */
function Thumb({ cfg, hour, delay }: { cfg: ThemeConfig; hour: number | null; delay: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = `${cfg.bg}|${cfg.lightMode}|${cfg.lightFixed}|${hour}|${cfg.lat}|${cfg.lon}`;
  useEffect(() => {
    const id = window.setTimeout(() => {
      const canvas = ref.current; if (!canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = 200, h = 125;
      canvas.width = w * dpr; canvas.height = h * dpr;
      const ctx = canvas.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const L = new ThemeLayer(true); L.setConfig(cfg); L.setPreviewHour(hour);
      // 둘레 장식이 있는 풍경(콜로세움·전투장·도트 성벽)은 아레나 귀퉁이를, 나머지는 바닥 한가운데를 보여 준다
      const framed = (bgOf(cfg.bg)?.frame ?? 'none') !== 'none', half = 600, zoom = framed ? 0.2 : 0.3, view = framed ? { x: half * 0.92, y: -half * 0.92 } : { x: 0, y: 0 };
      ctx.fillStyle = '#0b0f17'; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(zoom, zoom); ctx.translate(-view.x, -view.y);
      if (!L.drawFloor(ctx, half, view, zoom, w, h, 4300)) { ctx.fillStyle = rgb(DEFAULT_LOOK.floor); ctx.fillRect(-half, -half, half * 2, half * 2); }
      ctx.strokeStyle = L.gridColor ?? 'rgba(220,230,255,0.15)'; ctx.lineWidth = 1 / zoom; ctx.beginPath();
      for (let g = -half; g <= half; g += 100) { ctx.moveTo(g, -half); ctx.lineTo(g, half); ctx.moveTo(-half, g); ctx.lineTo(half, g); }
      ctx.stroke();
      for (const [x, y, r, c] of (framed ? [[half * 0.55, -half * 0.35, 46, '#4aa3ff'], [half * 0.25, -half * 0.62, 28, '#ff7a7a']] : [[-50, 20, 52, '#4aa3ff'], [70, -34, 32, '#ff7a7a']]) as [number, number, number, string][]) { ctx.fillStyle = c; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.restore();
      L.drawOverlay(ctx, w, h, 4300);
    }, delay);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <canvas ref={ref} className="th-thumb" aria-hidden="true" />;
}

// ------------------------------------------------------------------ 미리보기

/** 게임과 같은 ThemeLayer로 그린 작은 아레나(움직임 포함). 가운데에 예시 원 몇 개를 둔다 */
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
      const L = layer.current!, zoom = Math.min(w / 900, h / 560), half = 330, view = { x: 0, y: 0 };
      ctx.fillStyle = '#0b0f17'; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(zoom, zoom);
      if (!L.drawFloor(ctx, half, view, zoom, w, h, now)) { ctx.fillStyle = rgb(DEFAULT_LOOK.floor); ctx.fillRect(-half, -half, half * 2, half * 2); }
      ctx.strokeStyle = L.gridColor ?? 'rgba(220,230,255,0.15)'; ctx.lineWidth = 1 / zoom; ctx.beginPath();
      for (let g = -half; g <= half; g += 50) { ctx.moveTo(g, -half); ctx.lineTo(g, half); ctx.moveTo(-half, g); ctx.lineTo(half, g); }
      ctx.stroke();
      for (const [x, y, r, c] of [[-100, 20, 62, '#4aa3ff'], [95, -60, 42, '#ff7a7a'], [40, 110, 26, '#ffd166']] as const) {
        const sh = L.shadow(); ctx.fillStyle = `rgba(0,0,0,${sh ? sh.a : 0.28})`; ctx.beginPath(); ctx.arc(x + (sh ? sh.dx * r : 0), y + (sh ? sh.dy * r : r * 0.05), r + 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = c; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
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

/**
 * 태양 위치(NOAA 근사식): 위도·경도·시각(epoch ms, UTC 기준)으로 고도(도)와 오전 여부를 구한다.
 * 해가 뜨고 지는 시각을 서버에서 받지 않고 화면이 직접 계산하므로 외부 호출 없이 항상 같은 값이다(아레나 배경 테마, 4.38).
 */
const RAD = Math.PI / 180;

export interface Sun { alt: number; morning: boolean; /** 시간각(도, -180~180, 오전은 음수) */ hour: number }

export function solar(lat: number, lon: number, ms: number): Sun {
  const n = ms / 86400000 + 2440587.5 - 2451545.0; // J2000 이후 일수
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / RAD;
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  let hour = (gmst * 15 + lon - ra) % 360;
  if (hour > 180) hour -= 360;
  if (hour < -180) hour += 360;
  const alt = Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(hour * RAD)) / RAD;
  return { alt, morning: hour < 0, hour };
}

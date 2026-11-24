package com.trendist.arena.service;

import com.trendist.arena.support.Weather;
import com.trendist.arena.support.WeatherSource;
import com.trendist.setting.service.SettingService;
import com.trendist.setting.support.SettingKeys;
import java.util.Map;
import java.util.OptionalInt;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.springframework.stereotype.Service;

@Service
public class ArenaThemeServiceImpl implements ArenaThemeService {
    private static final long OK_TTL_MS = 15 * 60_000L, RETRY_MS = 60_000L;

    private record Cached(int weather, long nextAt) {}

    private final SettingService settings;
    private final WeatherSource source;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    private final Map<String, Boolean> loading = new ConcurrentHashMap<>();
    private final ExecutorService exec = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "arena-weather"); t.setDaemon(true); return t; });

    public ArenaThemeServiceImpl(SettingService settings, WeatherSource source) { this.settings = settings; this.source = source; }

    @Override
    public Theme current(String country) {
        boolean global = "GLOBAL".equalsIgnoreCase(country);
        double lat = settings.getDouble(global ? SettingKeys.ARENA_GLOBAL_LAT : SettingKeys.ARENA_KR_LAT);
        double lon = settings.getDouble(global ? SettingKeys.ARENA_GLOBAL_LON : SettingKeys.ARENA_KR_LON);
        int bg = clamp(settings.getInt(SettingKeys.ARENA_BG), 0, 40);
        int lightMode = clamp(settings.getInt(SettingKeys.ARENA_LIGHT_MODE), 0, 2);
        int lightFixed = clamp(settings.getInt(SettingKeys.ARENA_LIGHT_FIXED), 1, 4);
        int wm = clamp(settings.getInt(SettingKeys.ARENA_WEATHER_MODE), 0, 2);
        int weather = switch (wm) {
            case 2 -> clamp(settings.getInt(SettingKeys.ARENA_WEATHER_FIXED), 0, 5);
            case 1 -> real(lat, lon);
            default -> 0;
        };
        return new Theme(bg, lightMode, lightFixed, wm, weather, lat, lon, System.currentTimeMillis());
    }

    /** 캐시된 실제 날씨. 만료됐으면 뒤에서 새로 읽고(요청은 막지 않는다) 지금은 직전 값(없으면 맑음)을 준다 */
    private int real(double lat, double lon) {
        String key = String.format(java.util.Locale.ROOT, "%.2f,%.2f", lat, lon);
        Cached c = cache.get(key);
        long now = System.currentTimeMillis();
        if ((c == null || now >= c.nextAt()) && loading.putIfAbsent(key, true) == null) {
            exec.execute(() -> {
                try {
                    OptionalInt code = source.currentCode(lat, lon);
                    Cached prev = cache.get(key);
                    long t = System.currentTimeMillis();
                    if (code.isPresent()) cache.put(key, new Cached(Weather.fromWmo(code.getAsInt()), t + OK_TTL_MS));
                    else cache.put(key, new Cached(prev == null ? 0 : prev.weather(), t + RETRY_MS));
                } finally { loading.remove(key); }
            });
        }
        return c == null ? 0 : c.weather();
    }

    private static int clamp(int v, int lo, int hi) { return Math.max(lo, Math.min(hi, v)); }
}

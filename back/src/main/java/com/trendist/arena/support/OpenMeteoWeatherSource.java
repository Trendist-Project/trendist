package com.trendist.arena.support;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Locale;
import java.util.OptionalInt;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** Open-Meteo(키 없음)에서 지금 날씨 코드를 읽는다. 요청에는 좌표만 담고 사용자 정보는 담지 않는다. */
@Slf4j
@Component
@Profile("!test")
public class OpenMeteoWeatherSource implements WeatherSource {
    private static final Pattern CODE = Pattern.compile("\"current\"\\s*:\\s*\\{[^}]*\"weather_code\"\\s*:\\s*(\\d+)");
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

    @Override
    public OptionalInt currentCode(double lat, double lon) {
        try {
            URI uri = URI.create(String.format(Locale.ROOT, "https://api.open-meteo.com/v1/forecast?latitude=%.2f&longitude=%.2f&current=weather_code", lat, lon));
            HttpResponse<String> res = http.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(3)).GET().build(), HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) return OptionalInt.empty();
            Matcher m = CODE.matcher(res.body());
            return m.find() ? OptionalInt.of(Integer.parseInt(m.group(1))) : OptionalInt.empty();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return OptionalInt.empty();
        } catch (Exception e) {
            log.warn("weather fetch failed: {}", e.toString());
            return OptionalInt.empty();
        }
    }
}

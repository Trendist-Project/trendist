package com.trendist.arena.support;

import java.util.OptionalInt;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** 테스트 프로필: 외부 네트워크를 부르지 않는다. */
@Component
@Profile("test")
public class NoWeatherSource implements WeatherSource {
    @Override
    public OptionalInt currentCode(double lat, double lon) { return OptionalInt.empty(); }
}

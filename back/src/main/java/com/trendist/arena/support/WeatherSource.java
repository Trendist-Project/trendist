package com.trendist.arena.support;

import java.util.OptionalInt;

/** 좌표의 지금 날씨를 가져오는 곳(외부 서비스). 못 가져오면 empty. 테스트에서는 가짜로 바꾼다. */
public interface WeatherSource {
    /** WMO 날씨 코드(Open-Meteo weather_code). 실패하면 empty */
    OptionalInt currentCode(double lat, double lon);
}

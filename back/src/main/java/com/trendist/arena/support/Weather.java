package com.trendist.arena.support;

/** 아레나 날씨 번호(0 맑음 1 구름 2 비 3 눈 4 안개 5 뇌우)와 WMO 날씨 코드 변환 */
public final class Weather {
    private Weather() {}

    public static final int CLEAR = 0, CLOUDY = 1, RAIN = 2, SNOW = 3, FOG = 4, STORM = 5;

    /** WMO 코드 → 아레나 날씨. 모르는 코드는 구름 */
    public static int fromWmo(int code) {
        if (code == 0 || code == 1) return CLEAR;
        if (code == 2 || code == 3) return CLOUDY;
        if (code == 45 || code == 48) return FOG;
        if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return RAIN;
        if ((code >= 71 && code <= 77) || code == 85 || code == 86) return SNOW;
        if (code >= 95 && code <= 99) return STORM;
        return CLOUDY;
    }
}

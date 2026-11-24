package com.trendist.arena.service;

/** 아레나 배경(풍경)·조명(시간대)·날씨(관리자 설정, 4.38). */
public interface ArenaThemeService {
    record Theme(int bg, int lightMode, int lightFixed, int weatherMode, int weather, double lat, double lon, long nowMs) {}

    /** country가 GLOBAL이면 글로벌 위치, 아니면 KR 위치로 읽는다 */
    Theme current(String country);
}

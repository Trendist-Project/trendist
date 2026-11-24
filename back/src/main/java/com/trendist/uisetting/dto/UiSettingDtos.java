package com.trendist.uisetting.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** 게임 화면 설정 API(4.45). saved가 false면 저장한 적이 없어 기본값을 돌려 준 것이다(화면은 이 브라우저의 값을 올려 보낸다). */
public final class UiSettingDtos {
    private UiSettingDtos() {}

    public static final String CHAT_PATTERN = "open|collapsed|off";
    public static final int MIN_WIDTH = 200, MAX_WIDTH = 1200, MIN_HEIGHT = 120, MAX_HEIGHT = 2000;

    public record Response(boolean saved, boolean minimap, boolean leaderboard, String chat, boolean help, boolean autoFullscreen,
                           boolean sideHidden, Integer sideWidth, Integer sideHeight) {}

    public record UpdateRequest(boolean minimap, boolean leaderboard,
                                @NotNull @Pattern(regexp = CHAT_PATTERN) String chat,
                                boolean help, boolean autoFullscreen, boolean sideHidden,
                                @Min(MIN_WIDTH) @Max(MAX_WIDTH) Integer sideWidth,
                                @Min(MIN_HEIGHT) @Max(MAX_HEIGHT) Integer sideHeight) {}
}

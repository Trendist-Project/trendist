package com.trendist.sound.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/** 소리 설정 API(4.39). saved가 false면 저장한 적이 없어 기본값을 돌려 준 것이다(화면은 이 브라우저의 값을 올려 보낸다) */
public final class SoundDtos {
    private SoundDtos() {}

    public static final int DEFAULT_MASTER = 80, DEFAULT_SFX = 80, DEFAULT_BGM = 50;

    public record Response(boolean saved, boolean sfx, boolean bgm, int master, int sfxVolume, int bgmVolume) {}

    public record UpdateRequest(boolean sfx, boolean bgm,
                                @Min(0) @Max(100) int master, @Min(0) @Max(100) int sfxVolume, @Min(0) @Max(100) int bgmVolume) {}
}

package com.trendist.arena.controller;

import com.trendist.arena.service.ArenaThemeService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 아레나 배경 테마·날씨(4.38). 로그인 없이 읽는다. 값은 관리자 설정(아레나 배경·연출)과 외부 날씨로 정해진다. */
@RestController
@RequestMapping("/api/arena-theme")
@RequiredArgsConstructor
public class ArenaThemeController {
    private final ArenaThemeService themes;

    @GetMapping
    public ArenaThemeService.Theme get(@RequestParam(defaultValue = "KR") String country) { return themes.current(country); }
}

package com.trendist.sound.controller;

import com.trendist.auth.security.AuthUser;
import com.trendist.sound.dto.SoundDtos;
import com.trendist.sound.service.SoundSettingService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 내 소리 설정(4.39): 계정 기준이라 나라(KR·GLOBAL)와 기기가 달라도 이어진다. 게스트도 자기 계정으로 저장한다 */
@RestController
@RequestMapping("/api/me/sound")
@RequiredArgsConstructor
public class SoundSettingController {
    private final SoundSettingService service;

    @GetMapping
    public SoundDtos.Response get(@AuthenticationPrincipal AuthUser user) { return service.get(user.userId()); }

    @PutMapping
    public SoundDtos.Response save(@AuthenticationPrincipal AuthUser user, @Valid @RequestBody SoundDtos.UpdateRequest req) { return service.save(user.userId(), req); }
}

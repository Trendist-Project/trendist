package com.trendist.uisetting.controller;

import com.trendist.auth.security.AuthUser;
import com.trendist.uisetting.dto.UiSettingDtos;
import com.trendist.uisetting.service.UiSettingService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 내 게임 화면 설정(4.45): 계정 기준이라 나라(KR·GLOBAL)와 기기가 달라도 이어진다. 게스트도 자기 계정으로 저장한다. */
@RestController
@RequestMapping("/api/me/ui-settings")
@RequiredArgsConstructor
public class UiSettingController {
    private final UiSettingService service;

    @GetMapping
    public UiSettingDtos.Response get(@AuthenticationPrincipal AuthUser user) { return service.get(user.userId()); }

    @PutMapping
    public UiSettingDtos.Response save(@AuthenticationPrincipal AuthUser user, @Valid @RequestBody UiSettingDtos.UpdateRequest req) {
        return service.save(user.userId(), req);
    }
}

package com.trendist.uisetting.service;

import com.trendist.uisetting.dto.UiSettingDtos;
import com.trendist.uisetting.entity.UserUiSetting;
import com.trendist.uisetting.repository.UserUiSettingRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 계정별 게임 화면 설정(4.45): 저장한 값을 읽고, 없으면 기본값(saved = false)을 준다. 저장은 계정마다 한 줄을 덮어쓴다. */
@Service
@RequiredArgsConstructor
public class UiSettingService {
    private final UserUiSettingRepository repository;

    @Transactional(readOnly = true)
    public UiSettingDtos.Response get(long userId) {
        return repository.findByUserId(userId).map(UiSettingService::response)
                .orElseGet(() -> new UiSettingDtos.Response(false, true, true, "collapsed", true, true, false, null, null));
    }

    @Transactional
    public UiSettingDtos.Response save(long userId, UiSettingDtos.UpdateRequest r) {
        UserUiSetting s = repository.findByUserId(userId).orElseGet(() -> new UserUiSetting(userId));
        s.change(r.minimap(), r.leaderboard(), r.chat(), r.help(), r.autoFullscreen(), r.sideHidden(), r.sideWidth(), r.sideHeight());
        return response(repository.save(s));
    }

    private static UiSettingDtos.Response response(UserUiSetting s) {
        return new UiSettingDtos.Response(true, s.isMinimapOn(), s.isLeaderboardOn(), s.getChatView(), s.isHelpOpen(), s.isAutoFullscreen(),
                s.isSideHidden(), s.getSideWidth(), s.getSideHeight());
    }
}

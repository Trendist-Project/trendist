package com.trendist.sound.service;

import com.trendist.sound.dto.SoundDtos;
import com.trendist.sound.entity.UserSoundSetting;
import com.trendist.sound.repository.UserSoundSettingRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 계정별 소리 설정(4.39): 저장한 값을 읽고, 없으면 기본값(saved = false)을 준다. 저장은 계정마다 한 줄을 덮어쓴다 */
@Service
@RequiredArgsConstructor
public class SoundSettingService {
    private final UserSoundSettingRepository repository;

    @Transactional(readOnly = true)
    public SoundDtos.Response get(long userId) {
        return repository.findByUserId(userId).map(SoundSettingService::response)
                .orElseGet(() -> new SoundDtos.Response(false, true, false, SoundDtos.DEFAULT_MASTER, SoundDtos.DEFAULT_SFX, SoundDtos.DEFAULT_BGM));
    }

    @Transactional
    public SoundDtos.Response save(long userId, SoundDtos.UpdateRequest r) {
        UserSoundSetting s = repository.findByUserId(userId).orElse(null);
        if (s == null) s = new UserSoundSetting(userId, r.sfx(), r.bgm(), r.master(), r.sfxVolume(), r.bgmVolume());
        else s.change(r.sfx(), r.bgm(), r.master(), r.sfxVolume(), r.bgmVolume());
        return response(repository.save(s));
    }

    private static SoundDtos.Response response(UserSoundSetting s) {
        return new SoundDtos.Response(true, s.isSfxOn(), s.isBgmOn(), s.getMasterVolume(), s.getSfxVolume(), s.getBgmVolume());
    }
}

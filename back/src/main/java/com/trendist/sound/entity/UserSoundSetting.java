package com.trendist.sound.entity;

import com.trendist.common.entity.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 계정별 소리 설정(4.39). 계정(users)마다 한 줄. 음량은 0~100 정수 */
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(name = "user_sound_settings", uniqueConstraints = @UniqueConstraint(name = "uk_user_sound_settings_user", columnNames = "user_id"))
public class UserSoundSetting extends BaseTimeEntity {
    @Column(name = "user_id", nullable = false) private long userId;
    @Column(name = "sfx_on", nullable = false) private boolean sfxOn;
    @Column(name = "bgm_on", nullable = false) private boolean bgmOn;
    @Column(name = "master_volume", nullable = false) private int masterVolume;
    @Column(name = "sfx_volume", nullable = false) private int sfxVolume;
    @Column(name = "bgm_volume", nullable = false) private int bgmVolume;

    public UserSoundSetting(long userId, boolean sfxOn, boolean bgmOn, int masterVolume, int sfxVolume, int bgmVolume) {
        this.userId = userId; change(sfxOn, bgmOn, masterVolume, sfxVolume, bgmVolume);
    }

    public void change(boolean sfxOn, boolean bgmOn, int masterVolume, int sfxVolume, int bgmVolume) {
        this.sfxOn = sfxOn; this.bgmOn = bgmOn; this.masterVolume = masterVolume; this.sfxVolume = sfxVolume; this.bgmVolume = bgmVolume;
    }
}

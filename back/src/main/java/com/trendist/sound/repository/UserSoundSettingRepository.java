package com.trendist.sound.repository;

import com.trendist.sound.entity.UserSoundSetting;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserSoundSettingRepository extends JpaRepository<UserSoundSetting, Long> {
    Optional<UserSoundSetting> findByUserId(long userId);
}

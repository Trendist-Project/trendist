package com.trendist.uisetting.repository;

import com.trendist.uisetting.entity.UserUiSetting;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserUiSettingRepository extends JpaRepository<UserUiSetting, Long> {
    Optional<UserUiSetting> findByUserId(long userId);
}

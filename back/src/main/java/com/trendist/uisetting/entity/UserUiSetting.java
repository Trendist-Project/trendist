package com.trendist.uisetting.entity;

import com.trendist.common.entity.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 계정별 게임 화면 설정(4.45). 계정(users)마다 한 줄. sideWidth·sideHeight가 null이면 기본 크기. */
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(name = "user_ui_settings", uniqueConstraints = @UniqueConstraint(name = "uk_user_ui_settings_user", columnNames = "user_id"))
public class UserUiSetting extends BaseTimeEntity {
    @Column(name = "user_id", nullable = false) private long userId;
    @Column(name = "minimap_on", nullable = false) private boolean minimapOn;
    @Column(name = "leaderboard_on", nullable = false) private boolean leaderboardOn;
    @Column(name = "chat_view", nullable = false, length = 12) private String chatView;
    @Column(name = "help_open", nullable = false) private boolean helpOpen;
    @Column(name = "auto_fullscreen", nullable = false) private boolean autoFullscreen;
    @Column(name = "side_hidden", nullable = false) private boolean sideHidden;
    @Column(name = "side_width") private Integer sideWidth;
    @Column(name = "side_height") private Integer sideHeight;

    public UserUiSetting(long userId) { this.userId = userId; }

    public void change(boolean minimapOn, boolean leaderboardOn, String chatView, boolean helpOpen, boolean autoFullscreen,
                       boolean sideHidden, Integer sideWidth, Integer sideHeight) {
        this.minimapOn = minimapOn; this.leaderboardOn = leaderboardOn; this.chatView = chatView; this.helpOpen = helpOpen;
        this.autoFullscreen = autoFullscreen; this.sideHidden = sideHidden; this.sideWidth = sideWidth; this.sideHeight = sideHeight;
    }
}

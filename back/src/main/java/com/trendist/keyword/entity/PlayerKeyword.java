package com.trendist.keyword.entity;

import com.trendist.player.entity.Player;
import jakarta.persistence.*;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 보관함. + 한 번 = 한 행, 24시간 뒤 삭제. 만료 행을 재사용하면 created_at(+ 시각)을 새로 쓴다(9.4). */
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(name = "player_keywords",
        uniqueConstraints = @UniqueConstraint(name = "uk_player_keywords", columnNames = {"player_id", "keyword_id"}),
        indexes = {
                @Index(name = "idx_player_keywords_keyword", columnList = "keyword_id"),
                @Index(name = "idx_player_keywords_expires", columnList = "expires_at")})
public class PlayerKeyword {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "player_id", nullable = false) private Player player;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "keyword_id", nullable = false) private Keyword keyword;
    @Column(name = "expires_at", nullable = false, columnDefinition = "DATETIME(6)") private Instant expiresAt;
    @Column(name = "created_at", nullable = false, columnDefinition = "DATETIME(6)") private Instant createdAt;
    @org.hibernate.annotations.UpdateTimestamp
    @Column(name = "updated_at", nullable = false, columnDefinition = "DATETIME(6)") private Instant updatedAt;
    /** 이 행을 만든(또는 재사용한) + 요청의 번호. 추적용이며 null일 수 있다(V86). */
    @Column(name = "request_id", length = 36) private String requestId;

    public PlayerKeyword(Player player, Keyword keyword, Instant now, Instant expiresAt) {
        this.player = player; this.keyword = keyword; this.createdAt = now; this.expiresAt = expiresAt;
    }

    public void renew(Instant now, Instant expiresAt) { this.createdAt = now; this.expiresAt = expiresAt; }

    /** 요청 번호를 붙인다(같은 객체를 돌려준다) */
    public PlayerKeyword withRequest(String requestId) { this.requestId = requestId; return this; }

    public boolean isExpired(Instant now) { return !expiresAt.isAfter(now); }
}

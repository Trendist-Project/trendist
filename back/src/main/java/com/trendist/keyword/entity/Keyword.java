package com.trendist.keyword.entity;

import com.trendist.common.entity.BaseTimeEntity;
import com.trendist.country.entity.Country;
import jakarta.persistence.*;
import java.time.Instant;
import com.trendist.keyword.memory.KeywordCounters;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(name = "keywords",
        uniqueConstraints = @UniqueConstraint(name = "uk_keywords_country_normalized", columnNames = {"country_id", "normalized"}),
        indexes = @Index(name = "idx_keywords_state", columnList = "country_id, keyword_state_id, trend_value"))
// 바뀐 열만 UPDATE한다. + 는 키워드 행을 잠그지 않고 워커에서 처리하므로(KeywordServiceImpl.plus), 읽은 뒤 다른 경로가 고친 열을 덮어쓰지 않게 한다
@org.hibernate.annotations.DynamicUpdate
@jakarta.persistence.Cacheable
@org.hibernate.annotations.Cache(usage = org.hibernate.annotations.CacheConcurrencyStrategy.READ_WRITE) // 엔티티 2차 캐시(application.yml, 켜져 있을 때만)
public class Keyword extends BaseTimeEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "country_id", nullable = false) private Country country;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "data_source_id", nullable = false) private DataSource dataSource;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "keyword_state_id", nullable = false) private KeywordState keywordState;
    @Column(nullable = false, length = 20) private String text;
    @Column(nullable = false, length = 100) private String normalized;
    @Column(name = "trend_value", nullable = false) private long trendValue; // 정수 점수(4.8)
    @Column(name = "search_count", nullable = false) private long searchCount;
    @Column(name = "add_count", nullable = false) private long addCount;
    @Column(name = "holder_count", nullable = false) private long holderCount;
    /** 키워드 조회수(4.28): 공개 키워드 페이지와 게임 안 상세 팝업을 연 횟수. 같은 방문자는 하루 1번, 크롤러는 제외. 메모리에 모았다가 1분마다 더한다. */
    @Column(name = "view_count", nullable = false) private long viewCount;
    @Column(name = "activated_at", columnDefinition = "DATETIME(6)") private Instant activatedAt;
    @Column(name = "inactive_at", columnDefinition = "DATETIME(6)") private Instant inactiveAt;
    @Column(name = "banned_at", columnDefinition = "DATETIME(6)") private Instant bannedAt;
    /** 목록형 외부 소스(google)로 활성이 유지되는 끝 시각. 지나면 그 소스 목록에 아직 있는지 다시 본다(10.2). */
    @Column(name = "external_until", columnDefinition = "DATETIME(6)") private Instant externalUntil;
    /** 합성 키워드(4.44): 검색에 나오지 않고 합성으로만 존재한다. normalized는 `~` + 구성 번호 해시라 입력할 수 없는 값이다. */
    @Column(name = "is_merged", nullable = false) private boolean merged;
    /** 성(★) = 구성 원본(1성) 키워드 수. 일반 키워드는 1(4.44). */
    @Column(name = "star_count", nullable = false) private int starCount = 1;

    /** AI 한 줄 설명(4.12). 처음 만들기를 시도할 때 행이 생기고, 그 전에는 null이다. 설명 내용은 {@link KeywordAiComment}가 갖는다. */
    @OneToOne(fetch = FetchType.LAZY) @JoinColumn(name = "ai_comment_id", unique = true)
    @org.hibernate.annotations.OnDelete(action = org.hibernate.annotations.OnDeleteAction.SET_NULL)
    private KeywordAiComment aiComment;

    public Keyword(Country country, DataSource source, KeywordState state, String text, String normalized) {
        this.country = country; this.dataSource = source; this.keywordState = state;
        this.text = text; this.normalized = normalized;
    }

    /** 합성 키워드(4.44). 상태는 항상 🔥활성이다. */
    public static Keyword merged(Country country, DataSource source, KeywordState active, String text, String normalized, int stars, Instant now) {
        Keyword k = new Keyword(country, source, active, text, normalized);
        k.merged = true;
        k.starCount = stars;
        k.activate(active, now);
        return k;
    }

    public void setDataSource(DataSource dataSource) { this.dataSource = dataSource; }

    public void attachAiComment(KeywordAiComment row) { this.aiComment = row; }
    // 가진 사람 수·추가 횟수·점수: 메모리 카운터가 켜져 있고(KeywordCounters.INSTANCE) 이미 저장된 키워드면 메모리가 원천이다(DB는 1분마다 저장).
    // 꺼져 있으면 지금까지처럼 필드를 쓴다. 메모리를 쓸 때는 필드를 고치지 않아 이 값만 바뀐 트랜잭션은 keywords UPDATE를 만들지 않는다
    public long getHolderCount() { var s = KeywordCounters.INSTANCE; return s != null && id != null ? s.holder(id, holderCount, addCount, trendValue) : holderCount; }
    public long getAddCount() { var s = KeywordCounters.INSTANCE; return s != null && id != null ? s.add(id, holderCount, addCount, trendValue) : addCount; }
    public long getTrendValue() { var s = KeywordCounters.INSTANCE; return s != null && id != null ? s.trend(id, holderCount, addCount, trendValue) : trendValue; }
    public void setTrendValue(long trendValue) { var s = KeywordCounters.INSTANCE; if (s != null && id != null) s.setTrend(id, trendValue, holderCount, addCount, this.trendValue); else this.trendValue = trendValue; }
    public void incAdd() { var s = KeywordCounters.INSTANCE; if (s != null && id != null) s.addAdd(id, 1, holderCount, addCount, trendValue); else addCount++; }
    public void incHolder() { var s = KeywordCounters.INSTANCE; if (s != null && id != null) s.addHolder(id, 1, holderCount, addCount, trendValue); else holderCount++; }
    /** 가진 사람 수를 값으로 맞춘다(시작할 때 보관함에서 다시 센 값으로 바로잡는 데 쓴다) */
    public void setHolderCount(long v) { long cur = getHolderCount(); if (v > cur) { for (long i = cur; i < v; i++) incHolder(); } else { for (long i = v; i < cur; i++) decHolder(); } }
    public void decHolder() { var s = KeywordCounters.INSTANCE; if (s != null && id != null) s.addHolder(id, -1, holderCount, addCount, trendValue); else holderCount = Math.max(0, holderCount - 1); }
    public void addSearch(long n) { searchCount += n; }

    public void activate(KeywordState active, Instant now) {
        this.keywordState = active;
        if (activatedAt == null) activatedAt = now;
    }

    /** 외부 소스 목록에 올라 그 소스로 활성 유지 기간을 정한다. */
    public void holdExternal(DataSource source, Instant until) {
        this.dataSource = source;
        this.externalUntil = until;
    }

    /** 외부 유지 기간이 끝나 내부 데이터로 내린다. 상태는 서비스가 가진 사람 수로 다시 정한다. */
    public void dropExternal(DataSource internal) {
        this.dataSource = internal;
        this.externalUntil = null;
    }

    public void deactivate(KeywordState inactive, Instant now) {
        this.keywordState = inactive;
        this.inactiveAt = now;
    }

    /** 관리자 금지(13.1): 조회·점수에서 빠진다. 보관함·댓글 데이터는 그대로 둔다. */
    public void ban(KeywordState banned, Instant now) {
        this.keywordState = banned;
        this.bannedAt = now;
    }

    /** 금지 해제: 💤비활성으로 돌아간다(4.7). */
    public void unban(KeywordState inactive, Instant now) {
        this.keywordState = inactive;
        this.bannedAt = null;
        this.inactiveAt = now;
    }
}

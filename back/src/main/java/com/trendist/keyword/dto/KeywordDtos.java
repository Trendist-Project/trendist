package com.trendist.keyword.dto;

import com.trendist.player.dto.PlayerDtos;
import java.time.Instant;
import java.util.List;

public final class KeywordDtos {
    private KeywordDtos() {}

    /** 결과 카드(4.4). id가 null이면 아직 DB에 없는 새 단어(💤 카드). */
    public record KeywordCard(Long id, String text, String state, long trendValue,
                              long holderCount, long addCount, long searchCount,
                              long viewCount, boolean plusedByMe, Instant myExpiresAt, String aiComment, boolean aiCommentRequested) {}

    public record SearchResult(String status, KeywordCard keyword) {}

    /** 보관함 한 줄. merged면 합성 키워드(4.44): stars는 성, parts는 구성 원본(1성) 키워드. */
    public record MyKeyword(long keywordId, String text, String state, long trendValue,
                            Instant plusedAt, Instant expiresAt, boolean merged, int stars, List<MergedPart> parts) {}

    /** 합성 키워드의 구성 원본 한 개(4.44). */
    public record MergedPart(long keywordId, String text, String state, long trendValue) {}

    /**
     * 합성 미리보기(4.44). ok=false면 reason에 이유(글자 수 초과·구성 겹침·비활성 등).
     * score는 보너스 전 예상 점수(구성 점수 합 × 별 개수), bonusPercent는 +1성 보너스 확률(%), bonusPossible은 붙일 후보가 있는지.
     */
    public record MergePreview(boolean ok, String reason, String text, int stars, long partSum, int multiplier, long score, double failPercent,
                               int expireHours, int length, int maxLength, double bonusPercent, boolean bonusPossible,
                               List<MergedPart> parts) {}

    /** 합성 결과(4.44). bonus면 bonusPart가 덤으로 붙은 키워드, gained는 유행도 변화. */
    public record MergeResult(MyKeyword keyword, boolean bonus, MergedPart bonusPart, long gained, PlayerDtos.PlayerSummary player,
                              boolean failed, LostMaterial lost) {}

    /** 합성에 실패해 사라진 재료(점수가 낮은 쪽). 합성 키워드면 stars가 2 이상이다. */
    public record LostMaterial(String text, int stars, long trendValue) {}

    public record MergeRequest(@jakarta.validation.constraints.NotNull Long first, @jakarta.validation.constraints.NotNull Long second) {}

    /** 합성 키워드 상세 창(4.44): 요약 + 구성 원본 카드. expiresAt은 내가 가진 합성일 때만. */
    public record MergedDetail(long keywordId, String text, int stars, long trendValue, long partSum, int multiplier,
                               Instant myExpiresAt, List<KeywordCard> parts) {}

    /** 구슬을 먹은 결과(4.20). status: GAINED(새로 추가) / RENEWED(이미 보유, 만료시간만 갱신) / LOST(내 키워드 하나를 잃음, gained = 줄어든 유행도) / MISS(잃을 키워드도 없는 꽝) / NONE(🔥 키워드 없음). */
    public record OrbResult(String status, String text, String state, Long trendValue, long holderCount,
                            Long gained, Instant expiresAt, Long keywordId) {
        /** 키워드 번호 없이 만드는 결과(NONE·MISS처럼 키워드가 없거나 호출하는 쪽이 번호를 쓰지 않는 경우) */
        public OrbResult(String status, String text, String state, Long trendValue, long holderCount, Long gained, Instant expiresAt) {
            this(status, text, state, trendValue, holderCount, gained, expiresAt, null);
        }
    }

    public record PlusResult(KeywordCard keyword, long gained, PlayerDtos.PlayerSummary player) {}

    /**
     * 활동 그래프의 점 하나(4.12, 9.9). t는 그 구간의 시작(24시간은 정시, 나머지는 나라 현지 자정).
     * search(검색수)·plus(추가수)는 그 구간의 증분, holders는 구간이 끝날 때 가진 사람 수. live면 아직 집계 중인 이번 시간·오늘.
     */
    public record ActivityPoint(Instant t, long search, long plus, long holders, boolean live) {}

    /** 활동 그래프. range: 24h / 7d / 30d / 180d, timezone: 나라 시간대. */
    public record Activity(String range, String timezone, List<ActivityPoint> points, long searchCount, long addCount, long holders) {}

    /** 보관함 카드 등급 기준(4.42): normalMax는 노멀 등급의 끝(일반 키워드 1개의 최고 점수), mins는 레어·에픽·유니크·레전드리·신화의 최소 점수. */
    public record GradeInfo(long normalMax, List<Long> mins, double mergeFailPerStar, double mergeFailMax) {}

    public record PlusRequest(@jakarta.validation.constraints.NotBlank String text) {}
}

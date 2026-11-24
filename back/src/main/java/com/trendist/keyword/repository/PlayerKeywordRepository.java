package com.trendist.keyword.repository;

import com.trendist.keyword.entity.PlayerKeyword;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PlayerKeywordRepository extends JpaRepository<PlayerKeyword, Long> {
    Optional<PlayerKeyword> findByPlayerIdAndKeywordId(Long playerId, Long keywordId);

    @Query("""
            select pk from PlayerKeyword pk join fetch pk.keyword k join fetch k.keywordState
            where pk.player.id = :playerId and pk.expiresAt > :now and k.keywordState.id <> :bannedStateId
            order by pk.createdAt desc""")
    List<PlayerKeyword> findActiveByPlayer(@Param("playerId") Long playerId, @Param("now") Instant now,
                                           @Param("bannedStateId") Long bannedStateId);

    /**
     * 금지된 키워드를 가진 보관함 행 번호(만료된 것 포함, 4.7): 그 키워드와 똑같은 것, contain이면 금지어가 들어 있는 다른 키워드까지.
     */
    @Query("""
            select pk.id from PlayerKeyword pk
            where pk.keyword.country.code = :countryCode
              and (pk.keyword.normalized = :normalized or (:contain = true and locate(:normalized, pk.keyword.normalized) > 0))""")
    List<Long> findIdsHoldingBanned(@Param("countryCode") String countryCode, @Param("normalized") String normalized, @Param("contain") boolean contain);

    /** 현재 유행도의 키워드 점수 부분: 🔥활성 키워드의 trend_value 합(4.8). */
    @Query("""
            select coalesce(sum(k.trendValue), 0) from PlayerKeyword pk join pk.keyword k
            where pk.player.id = :playerId and pk.expiresAt > :now and k.keywordState.id = :activeStateId""")
    long sumActiveTrendValue(@Param("playerId") Long playerId, @Param("now") Instant now,
                                   @Param("activeStateId") Long activeStateId);

    /** 나라별 활동 인원: 만료 전 키워드를 하나 이상 가진 플레이어 수(탈퇴 제외, 4.8). [country_id, count] */
    @Query("""
            select p.country.id, count(distinct p.id) from PlayerKeyword pk join pk.player p join p.user u
            where pk.expiresAt > :now and u.userState.id <> :withdrawnStateId
            group by p.country.id""")
    List<Object[]> countHoldingPlayersByCountry(@Param("now") Instant now, @Param("withdrawnStateId") Long withdrawnStateId);

    /** 보유 키워드 수: 합성 키워드는 구성 원본 수(성)로 센다(4.44). */
    @Query("select coalesce(sum(pk.keyword.starCount), 0) from PlayerKeyword pk where pk.player.id = :playerId and pk.expiresAt > :now")
    long countUnexpired(@Param("playerId") Long playerId, @Param("now") Instant now);

    @Query("select pk.player.id from PlayerKeyword pk where pk.keyword.id = :keywordId and pk.expiresAt > :now")
    List<Long> findHolderPlayerIds(@Param("keywordId") Long keywordId, @Param("now") Instant now);

    @Query("select pk.id from PlayerKeyword pk where pk.expiresAt <= :now order by pk.expiresAt")
    List<Long> findExpiredIds(@Param("now") Instant now, Pageable pageable);

    /** 잃는 후보: 만료 전이고 금지되지 않은 키워드(4.3). */
    @Query("""
            select pk from PlayerKeyword pk join fetch pk.keyword k
            where pk.player.id = :playerId and pk.expiresAt > :now and k.keywordState.id <> :bannedStateId""")
    List<PlayerKeyword> findLosableByPlayer(@Param("playerId") Long playerId, @Param("now") Instant now,
                                            @Param("bannedStateId") Long bannedStateId);

    /**
     * 이 키워드를 "가진" 보관함 행(4.44): 그 키워드 자체이거나, 그 키워드가 구성 원본으로 들어 있는 합성 키워드. 만료 전만.
     * 합성 키워드를 가지면 구성 원본을 가진 것으로 판정한다.
     */
    @Query("""
            select pk from PlayerKeyword pk
            where pk.player.id = :playerId and pk.expiresAt > :now
              and (pk.keyword.id = :keywordId
                   or pk.keyword.id in (select m.keywordId from KeywordMergePart m where m.partKeywordId = :keywordId))""")
    List<PlayerKeyword> findCovering(@Param("playerId") Long playerId, @Param("keywordId") Long keywordId, @Param("now") Instant now);

    /** 만료 전 합성 키워드 보관함 행(4.44). */
    @Query("""
            select pk from PlayerKeyword pk join fetch pk.keyword k
            where pk.player.id = :playerId and pk.expiresAt > :now and k.merged = true""")
    List<PlayerKeyword> findMergedByPlayer(@Param("playerId") Long playerId, @Param("now") Instant now);

    /** 구성 원본으로 이 키워드가 든 합성 보관함 행과 그 원본 번호 [행 번호, 원본 번호] (금지 정리, 4.44). contain이면 금지어가 들어 있는 원본까지. */
    @Query("""
            select pk.id, m.partKeywordId from PlayerKeyword pk, KeywordMergePart m, Keyword part
            where pk.keyword.id = m.keywordId and part.id = m.partKeywordId and part.country.code = :countryCode
              and (part.normalized = :normalized or (:contain = true and locate(:normalized, part.normalized) > 0))""")
    List<Object[]> findMergedRowsWithBannedPart(@Param("countryCode") String countryCode, @Param("normalized") String normalized,
                                                @Param("contain") boolean contain);

    /** 이 원본이 든 합성 키워드의 만료 전 보관함 행 번호(원본이 💤가 됐을 때 빼낸다, 4.44). */
    @Query("""
            select pk.id from PlayerKeyword pk
            where pk.expiresAt > :now
              and pk.keyword.id in (select m.keywordId from KeywordMergePart m where m.partKeywordId = :partId)""")
    List<Long> findMergedRowIdsWithPart(@Param("partId") Long partId, @Param("now") Instant now);

    /** 그 나라의 합성 키워드 보관함 행 번호(만료된 것 포함). 이어 붙인 글자가 금지어를 품었는지 보려고 쓴다(4.44). */
    @Query("select pk.id from PlayerKeyword pk where pk.keyword.merged = true and pk.keyword.country.code = :countryCode")
    List<Long> findMergedRowIdsByCountry(@Param("countryCode") String countryCode);

    @Modifying
    @Query("delete from PlayerKeyword pk where pk.id = :id and pk.expiresAt <= :now")
    int deleteIfExpired(@Param("id") Long id, @Param("now") Instant now);

    /** 그 시각 뒤에 +되어 아직 남아 있는 행 수. 직전 기록이 없을 때 그 시간의 추가수를 어림한다(9.9). */
    @Query("select count(pk) from PlayerKeyword pk where pk.keyword.id = :keywordId and pk.createdAt >= :since")
    long countPlusedSince(@Param("keywordId") Long keywordId, @Param("since") Instant since);

    /** 정보 팝업의 상위 키워드(4.11): 만료 전·금지 아님, 트렌드 값 높은 순(같으면 최근에 넣은 순). */
    @Query("""
            select pk from PlayerKeyword pk join fetch pk.keyword k join fetch k.keywordState
            where pk.player.id = :playerId and pk.expiresAt > :now and k.keywordState.id <> :bannedStateId
            order by k.trendValue desc, pk.createdAt desc""")
    List<PlayerKeyword> findTopByPlayer(@Param("playerId") Long playerId, @Param("now") Instant now,
                                        @Param("bannedStateId") Long bannedStateId, Pageable pageable);
}

package com.trendist.keyword.holding;

import com.trendist.keyword.entity.PlayerKeyword;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;

/**
 * 보관함(플레이어가 가진 키워드와 만료 시각)에 대한 모든 접근. 서비스는 DB(JPA)를 직접 부르지 않고 이 창구를 거친다.
 * 지금 구현은 DB를 쓰는 {@link JpaHoldings}이고, 계획(docs/plans/memory-holdings.md)에 따라 서버 메모리를 원천으로 하는 구현으로 바꿀 수 있다.
 * 반환하는 행({@link PlayerKeyword})은 읽고 고쳐서 {@link #flush()}로 반영하는 방식으로 쓴다.
 */
public interface Holdings {
    // ---- 한 행 읽기
    Optional<PlayerKeyword> findById(Long id);
    /** 이 플레이어가 이 키워드를 직접 가진 행(만료된 행 포함) */
    Optional<PlayerKeyword> findByPlayerIdAndKeywordId(Long playerId, Long keywordId);
    List<PlayerKeyword> findByPlayerIdAndKeywordIdIn(Long playerId, Collection<Long> keywordIds);
    /** 이 키워드를 가진 것으로 치는 행: 직접 가진 행, 또는 그 키워드를 구성 원본으로 가진 합성 키워드의 행(4.44) */
    List<PlayerKeyword> findCovering(Long playerId, Long keywordId, Instant now);

    // ---- 플레이어의 목록
    /** 만료 전이고 금지가 아닌 행(얻은 시각이 최근인 것부터) */
    List<PlayerKeyword> findActiveByPlayer(Long playerId, Instant now, Long bannedStateId);
    /** 잃는 후보: 만료 전이고 금지되지 않은 행 */
    List<PlayerKeyword> findLosableByPlayer(Long playerId, Instant now, Long bannedStateId);
    List<PlayerKeyword> findTopByPlayer(Long playerId, Instant now, Long bannedStateId, Pageable pageable);

    // ---- 집계
    /** 활성 키워드 점수의 합(플레이어 점수의 키워드 몫) */
    long sumActiveTrendValue(Long playerId, Instant now, Long activeStateId);
    /** 보유 키워드 수: 합성 키워드는 구성 원본 수(성)로 센다(4.44) */
    long countUnexpired(Long playerId, Instant now);
    List<Long> findHolderPlayerIds(Long keywordId, Instant now);
    long countPlusedSince(Long keywordId, Instant since);
    /** 나라별로 키워드를 가진 플레이어 수 [나라 번호, 수] */
    List<Object[]> countHoldingPlayersByCountry(Instant now, Long withdrawnStateId);

    // ---- 만료·금지 정리
    List<Long> findExpiredIds(Instant now, Pageable pageable);
    int deleteIfExpired(Long id, Instant now);
    List<Long> findIdsHoldingBanned(String countryCode, String normalized, boolean contain);
    List<Object[]> findMergedRowsWithBannedPart(String countryCode, String normalized, boolean contain);
    List<Long> findMergedRowIdsWithPart(Long partId, Instant now);
    List<Long> findMergedRowIdsByCountry(String countryCode);

    // ---- 쓰기
    PlayerKeyword save(PlayerKeyword row);
    void delete(PlayerKeyword row);
    void deleteAll(Iterable<PlayerKeyword> rows);
    /** 고친 행을 반영한다 */
    void flush();
}

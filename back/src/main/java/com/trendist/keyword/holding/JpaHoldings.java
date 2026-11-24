package com.trendist.keyword.holding;

import com.trendist.keyword.entity.PlayerKeyword;
import com.trendist.keyword.memory.KeywordCounters;
import com.trendist.keyword.repository.PlayerKeywordRepository;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Component;

/** {@link Holdings}의 DB 구현: player_keywords를 JPA로 읽고 쓴다(지금의 동작 그대로). */
@Component
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name = "trendist.memory-holdings", havingValue = "false", matchIfMissing = true)
@RequiredArgsConstructor
public class JpaHoldings implements Holdings {
    private final PlayerKeywordRepository repo;

    @Override public Optional<PlayerKeyword> findById(Long id) { return repo.findById(id); }
    @Override public Optional<PlayerKeyword> findByPlayerIdAndKeywordId(Long playerId, Long keywordId) { return repo.findByPlayerIdAndKeywordId(playerId, keywordId); }
    @Override public List<PlayerKeyword> findByPlayerIdAndKeywordIdIn(Long playerId, Collection<Long> keywordIds) { return repo.findByPlayerIdAndKeywordIdIn(playerId, keywordIds); }
    @Override public List<PlayerKeyword> findCovering(Long playerId, Long keywordId, Instant now) { return repo.findCovering(playerId, keywordId, now); }

    @Override public List<PlayerKeyword> findActiveByPlayer(Long playerId, Instant now, Long bannedStateId) { return repo.findActiveByPlayer(playerId, now, bannedStateId); }
    @Override public List<PlayerKeyword> findLosableByPlayer(Long playerId, Instant now, Long bannedStateId) { return repo.findLosableByPlayer(playerId, now, bannedStateId); }
    @Override
    public List<PlayerKeyword> findTopByPlayer(Long playerId, Instant now, Long bannedStateId, Pageable pageable) {
        if (KeywordCounters.INSTANCE == null) return repo.findTopByPlayer(playerId, now, bannedStateId, pageable);
        // 키워드 점수가 메모리(카운터)에 있으면 DB의 trend_value는 낡았을 수 있어 메모리 값으로 직접 정렬한다
        List<PlayerKeyword> all = new java.util.ArrayList<>(repo.findActiveByPlayer(playerId, now, bannedStateId));
        all.sort(java.util.Comparator.<PlayerKeyword>comparingLong(r -> r.getKeyword().getTrendValue()).reversed()
                .thenComparing(java.util.Comparator.comparing(PlayerKeyword::getCreatedAt).reversed()));
        return pageable.isUnpaged() ? all : all.stream().limit(pageable.getPageSize()).toList();
    }

    @Override
    public long sumActiveTrendValue(Long playerId, Instant now, Long activeStateId) {
        if (KeywordCounters.INSTANCE == null) return repo.sumActiveTrendValue(playerId, now, activeStateId);
        // 키워드 점수가 메모리(카운터)에 있으면 DB 합계는 낡았을 수 있어 행을 읽어 메모리 값으로 합한다(행이 DB에 있는 구현 한정)
        long sum = 0;
        for (PlayerKeyword pk : repo.findActiveByPlayer(playerId, now, -1L)) { // -1: 금지 제외 없이 모두(상태는 아래에서 본다)
            if (pk.getKeyword().getKeywordState().getId().equals(activeStateId)) sum += pk.getKeyword().getTrendValue();
        }
        return sum;
    }
    @Override public long countUnexpired(Long playerId, Instant now) { return repo.countUnexpired(playerId, now); }
    @Override public List<Long> findHolderPlayerIds(Long keywordId, Instant now) { return repo.findHolderPlayerIds(keywordId, now); }
    @Override public long countPlusedSince(Long keywordId, Instant since) { return repo.countPlusedSince(keywordId, since); }
    @Override public List<Object[]> countHoldingPlayersByCountry(Instant now, Long withdrawnStateId) { return repo.countHoldingPlayersByCountry(now, withdrawnStateId); }

    @Override public List<Long> findExpiredIds(Instant now, Pageable pageable) { return repo.findExpiredIds(now, pageable); }
    @Override public int deleteIfExpired(Long id, Instant now) { return repo.deleteIfExpired(id, now); }
    @Override public List<Long> findIdsHoldingBanned(String countryCode, String normalized, boolean contain) { return repo.findIdsHoldingBanned(countryCode, normalized, contain); }
    @Override public List<Object[]> findMergedRowsWithBannedPart(String countryCode, String normalized, boolean contain) { return repo.findMergedRowsWithBannedPart(countryCode, normalized, contain); }
    @Override public List<Long> findMergedRowIdsWithPart(Long partId, Instant now) { return repo.findMergedRowIdsWithPart(partId, now); }
    @Override public List<Long> findMergedRowIdsByCountry(String countryCode) { return repo.findMergedRowIdsByCountry(countryCode); }

    @Override public PlayerKeyword save(PlayerKeyword row) { return repo.save(row); }
    @Override public void delete(PlayerKeyword row) { repo.delete(row); }
    @Override public void deleteAll(Iterable<PlayerKeyword> rows) { repo.deleteAll(rows); }
    @Override public void flush() { repo.flush(); }
}

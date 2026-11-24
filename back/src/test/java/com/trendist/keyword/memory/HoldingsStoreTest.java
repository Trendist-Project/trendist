package com.trendist.keyword.memory;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class HoldingsStoreTest {
    private static final Instant T0 = Instant.parse("2026-11-25T00:00:00Z");
    private static final Instant IN_1H = T0.plus(Duration.ofHours(1));
    private static final Instant IN_24H = T0.plus(Duration.ofHours(24));

    @Test
    void upsertCreatesOnceThenRenewsAndExpiredRowsAreReused() {
        var s = new HoldingsStore();
        assertThat(s.upsert(1, 10, T0, IN_24H)).isTrue();
        assertThat(s.upsert(1, 10, IN_1H, IN_1H.plus(Duration.ofHours(24)))).isFalse(); // 같은 행의 시각만 갱신
        assertThat(s.row(1, 10)).get().extracting(HoldingsStore.Holding::createdAt).isEqualTo(IN_1H);
        assertThat(s.active(1, T0.plus(Duration.ofHours(20)))).hasSize(1);
        assertThat(s.active(1, T0.plus(Duration.ofHours(26)))).isEmpty(); // 갱신한 만료(T0+25시간) 후에는 보이지 않지만
        assertThat(s.row(1, 10)).isPresent();                                  // 행은 남아 있어 재사용할 수 있다
    }

    @Test
    void coveringAndCoveredIdsCountOriginalsInsideMergedKeywords() {
        var s = new HoldingsStore();
        s.registerMerged(100, List.of(10L, 11L, 12L));
        s.upsert(1, 100, T0, IN_24H); // 합성 키워드를 가졌다
        s.upsert(1, 13, T0, IN_24H);
        assertThat(s.covering(1, 11, T0).orElseThrow().keywordId()).isEqualTo(100); // 구성 원본도 가진 것
        assertThat(s.covering(1, 13, T0).orElseThrow().keywordId()).isEqualTo(13);
        assertThat(s.covering(1, 99, T0)).isEmpty();
        assertThat(s.coveredIds(1, T0)).containsExactlyInAnyOrder(100L, 10L, 11L, 12L, 13L);
        assertThat(s.holdCount(1, T0, id -> id == 100 ? 3 : 1)).isEqualTo(4); // 합성은 성(구성 수)으로 센다
        assertThat(s.coveredIds(1, IN_24H)).isEmpty(); // 만료되면 가진 것으로 치지 않는다
    }

    @Test
    void removeAndExpiryCleanupKeepHolderIndexConsistent() {
        var s = new HoldingsStore();
        s.upsert(1, 10, T0, IN_1H);
        s.upsert(2, 10, T0, IN_24H);
        assertThat(s.holderPlayerIds(10, T0)).containsExactlyInAnyOrder(1L, 2L);
        var removed = s.removeExpired(IN_1H);
        assertThat(removed).extracting(HoldingsStore.Row::playerId).containsExactly(1L);
        assertThat(s.holderPlayerIds(10, IN_1H)).containsExactly(2L);
        assertThat(s.remove(2, 10)).isTrue();
        assertThat(s.remove(2, 10)).isFalse();
        assertThat(s.holderPlayerIds(10, T0)).isEmpty();
        assertThat(s.size()).isZero();
    }

    @Test
    void exportAndLoadRoundTrip() {
        var a = new HoldingsStore();
        a.upsert(1, 10, T0, IN_24H);
        a.upsert(1, 11, IN_1H, IN_24H);
        a.upsert(2, 10, T0, IN_1H);
        var b = new HoldingsStore();
        b.load(a.exportAll());
        assertThat(b.size()).isEqualTo(3);
        assertThat(b.row(1, 11)).get().extracting(HoldingsStore.Holding::createdAt).isEqualTo(IN_1H);
        assertThat(b.holderPlayerIds(10, T0)).containsExactlyInAnyOrder(1L, 2L);
    }

    @Test
    void activeListsMostRecentlyGainedFirst() {
        var s = new HoldingsStore();
        s.upsert(1, 10, T0, IN_24H);
        s.upsert(1, 11, IN_1H, IN_24H);
        assertThat(s.active(1, IN_1H)).extracting(HoldingsStore.Holding::keywordId).containsExactly(11L, 10L);
    }
}

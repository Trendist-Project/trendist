package com.trendist.keyword.memory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.trendist.keyword.entity.DataSource;
import com.trendist.keyword.repository.KeywordRepository;
import com.trendist.keyword.service.KeywordService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.support.TransactionTemplate;

/** 키워드 카운터를 메모리가 원천으로 쓰는 구현(trendist.memory-counters=true): 트랜잭션 롤백, 1분 저장. 정적 INSTANCE가 다른 시험에 번지지 않게 끝나면 컨텍스트를 닫는다. */
// 이 시험은 끝나면 컨텍스트를 닫는데, 2차 캐시의 캐시 관리자는 JVM 안에서 공유돼 닫으면 다른 컨텍스트의 캐시까지 닫히므로 이 컨텍스트는 2차 캐시를 쓰지 않는다
@SpringBootTest(properties = {"trendist.memory-counters=true", "spring.jpa.properties.hibernate.cache.use_second_level_cache=false"})
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class KeywordCountersTest {
    @Autowired KeywordService keywordService;
    @Autowired KeywordRepository keywords;
    @Autowired TransactionTemplate tx;
    @Autowired JdbcTemplate jdbc;
    @Autowired KeywordCounterSync sync;

    private long keywordId(String text) {
        keywordService.applyExternalTitles("KR", DataSource.GOOGLE, List.of(text));
        return keywords.findByCountryIdAndNormalized(1L, text.replace(" ", "")).orElseThrow().getId();
    }

    private long dbHolder(long id) { return jdbc.queryForObject("select holder_count from keywords where id = ?", Long.class, id); }

    @Test
    void countersAreInMemoryAndOnlyWrittenToTheDatabaseByTheSync() {
        assertThat(KeywordCounters.INSTANCE).isNotNull();
        long id = keywordId("카운터메모리");
        long before = keywords.findById(id).orElseThrow().getHolderCount();
        tx.executeWithoutResult(st -> keywords.findById(id).orElseThrow().incHolder());
        assertThat(keywords.findById(id).orElseThrow().getHolderCount()).isEqualTo(before + 1); // 읽기는 메모리 값
        assertThat(dbHolder(id)).isEqualTo(before);                                             // DB는 아직 그대로(1분 저장 전)
        sync.flush();
        assertThat(dbHolder(id)).isEqualTo(before + 1);                                         // 저장하면 DB가 맞춰진다
    }

    @Test
    void rolledBackTransactionDoesNotChangeCounters() {
        long id = keywordId("카운터롤백");
        long holder = keywords.findById(id).orElseThrow().getHolderCount();
        long add = keywords.findById(id).orElseThrow().getAddCount();
        assertThatThrownBy(() -> tx.executeWithoutResult(st -> {
            var k = keywords.findById(id).orElseThrow();
            k.incHolder(); k.incAdd(); k.setTrendValue(999);
            assertThat(k.getHolderCount()).isEqualTo(holder + 1); // 같은 트랜잭션 안에서는 바뀐 값이 보인다
            assertThat(k.getTrendValue()).isEqualTo(999);
            throw new IllegalStateException("롤백");
        })).isInstanceOf(IllegalStateException.class);
        var after = keywords.findById(id).orElseThrow();
        assertThat(after.getHolderCount()).isEqualTo(holder);
        assertThat(after.getAddCount()).isEqualTo(add);
        assertThat(after.getTrendValue()).isNotEqualTo(999);
    }

    @Test
    void holderCountNeverGoesBelowZero() {
        long id = keywordId("카운터바닥");
        tx.executeWithoutResult(st -> { var k = keywords.findById(id).orElseThrow(); for (int i = 0; i < 5; i++) k.decHolder(); });
        assertThat(keywords.findById(id).orElseThrow().getHolderCount()).isZero();
    }
}

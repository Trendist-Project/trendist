package com.trendist.keyword.memory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.jayway.jsonpath.JsonPath;
import com.trendist.keyword.entity.DataSource;
import com.trendist.keyword.entity.PlayerKeyword;
import com.trendist.keyword.holding.Holdings;
import com.trendist.keyword.holding.MemoryHoldings;
import com.trendist.keyword.repository.KeywordRepository;
import com.trendist.keyword.repository.PlayerKeywordRepository;
import com.trendist.keyword.service.KeywordService;
import com.trendist.player.repository.PlayerRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

/** 보관함을 메모리가 원천으로 쓰는 구현(trendist.memory-holdings=true)의 동작: 트랜잭션 롤백, 정상 종료 때 DB 저장. */
@SpringBootTest(properties = "trendist.memory-holdings=true")
@ActiveProfiles("test")
@AutoConfigureMockMvc
class MemoryHoldingsTest {
    @Autowired MockMvc mvc;
    @Autowired Holdings holdings;
    @Autowired HoldingsStore store;
    @Autowired TransactionTemplate tx;
    @Autowired KeywordService keywordService;
    @Autowired KeywordRepository keywords;
    @Autowired PlayerRepository players;
    @Autowired PlayerKeywordRepository rows;

    private long playerOf(String nickname) throws Exception {
        String token = JsonPath.read(mvc.perform(post("/api/auth/guest")).andReturn().getResponse().getContentAsString(), "$.accessToken");
        mvc.perform(post("/api/players").header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON).content("{\"nickname\":\"" + nickname + "\"}"));
        return ((Number) JsonPath.read(mvc.perform(get("/api/me").header("Authorization", "Bearer " + token)).andReturn().getResponse().getContentAsString(), "$.player.id")).longValue();
    }

    @Test
    void theMemoryImplementationIsTheOneInUse() {
        assertThat(holdings).isInstanceOf(MemoryHoldings.class);
    }

    @Test
    void rolledBackTransactionLeavesMemoryUntouchedAndCommittedOneIsVisible() throws Exception {
        long pid = playerOf("메모리롤백");
        keywordService.applyExternalTitles("KR", DataSource.GOOGLE, List.of("메모리롤백키워드"));
        long kid = keywords.findByCountryIdAndNormalized(1L, "메모리롤백키워드").orElseThrow().getId();
        Instant now = Instant.now();
        int before = store.size();

        assertThatThrownBy(() -> tx.executeWithoutResult(st -> {
            holdings.save(new PlayerKeyword(players.getReferenceById(pid), keywords.getReferenceById(kid), now, now.plus(Duration.ofHours(24))));
            // 같은 트랜잭션 안에서는 방금 넣은 행이 보인다
            assertThat(holdings.findByPlayerIdAndKeywordId(pid, kid)).isPresent();
            throw new IllegalStateException("롤백");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(holdings.findByPlayerIdAndKeywordId(pid, kid)).isEmpty(); // 롤백: 메모리에 남지 않는다
        assertThat(store.size()).isEqualTo(before);

        tx.executeWithoutResult(st -> holdings.save(new PlayerKeyword(players.getReferenceById(pid), keywords.getReferenceById(kid), now, now.plus(Duration.ofHours(24)))));
        assertThat(holdings.findByPlayerIdAndKeywordId(pid, kid)).isPresent(); // 커밋: 보인다
        assertThat(holdings.findHolderPlayerIds(kid, now)).contains(pid);
    }

    @Test
    void saveOnShutdownWritesOnlyUnexpiredRowsToTheDatabase() throws Exception {
        long pid = playerOf("메모리종료저장");
        keywordService.applyExternalTitles("KR", DataSource.GOOGLE, List.of("종료저장가", "종료저장나"));
        long a = keywords.findByCountryIdAndNormalized(1L, "종료저장가").orElseThrow().getId(), b = keywords.findByCountryIdAndNormalized(1L, "종료저장나").orElseThrow().getId();
        Instant now = Instant.now();
        tx.executeWithoutResult(st -> {
            holdings.save(new PlayerKeyword(players.getReferenceById(pid), keywords.getReferenceById(a), now, now.plus(Duration.ofHours(24))));
            holdings.save(new PlayerKeyword(players.getReferenceById(pid), keywords.getReferenceById(b), now.minusSeconds(7200), now.minusSeconds(3600))); // 이미 만료
        });
        ((MemoryHoldings) holdings).flushToDb();
        long inDb = rows.findAllRaw().stream().filter(r -> ((Number) r[1]).longValue() == pid).count();
        assertThat(inDb).isEqualTo(1); // 만료된 것은 저장하지 않는다
    }

    @Test
    void onlyChangedRowsAreSyncedAndDeletionsReachTheDatabase() throws Exception {
        long pid = playerOf("메모리증분");
        keywordService.applyExternalTitles("KR", DataSource.GOOGLE, List.of("증분가", "증분나"));
        long a = keywords.findByCountryIdAndNormalized(1L, "증분가").orElseThrow().getId(), b = keywords.findByCountryIdAndNormalized(1L, "증분나").orElseThrow().getId();
        Instant now = Instant.now();
        tx.executeWithoutResult(st -> {
            holdings.save(new PlayerKeyword(players.getReferenceById(pid), keywords.getReferenceById(a), now, now.plus(Duration.ofHours(24))));
            holdings.save(new PlayerKeyword(players.getReferenceById(pid), keywords.getReferenceById(b), now, now.plus(Duration.ofHours(24))));
        });
        MemoryHoldings mh = (MemoryHoldings) holdings;
        mh.flushToDb();
        assertThat(rows.findAllRaw().stream().filter(r -> ((Number) r[1]).longValue() == pid).count()).isEqualTo(2);
        // 이미 저장한 것은 다시 쓰지 않는다: 바뀐 표시가 없다
        assertThat(store.drainDirty()).isEmpty();
        // 하나를 지우면 DB에서도 지워지고, 나머지는 그대로다
        tx.executeWithoutResult(st -> holdings.delete(holdings.findByPlayerIdAndKeywordId(pid, a).orElseThrow()));
        mh.flushToDb();
        assertThat(rows.findAllRaw().stream().filter(r -> ((Number) r[1]).longValue() == pid).map(r -> ((Number) r[2]).longValue()).toList()).containsExactly(b);
    }

    @Test
    void startupReconcileFixesHolderAndHoldCountsFromTheHoldings() throws Exception {
        long pid = playerOf("메모리보정");
        keywordService.applyExternalTitles("KR", DataSource.GOOGLE, List.of("보정가"));
        long a = keywords.findByCountryIdAndNormalized(1L, "보정가").orElseThrow().getId();
        Instant now = Instant.now();
        tx.executeWithoutResult(st -> holdings.save(new PlayerKeyword(players.getReferenceById(pid), keywords.getReferenceById(a), now, now.plus(Duration.ofHours(24)))));
        // 갑자기 죽어 숫자가 어긋난 것처럼 만든다: 가진 사람 수 7, 보유 수 9
        tx.executeWithoutResult(st -> { keywords.findById(a).orElseThrow().setHolderCount(7); players.findById(pid).orElseThrow().setHoldCount(9); });
        assertThat(keywords.findById(a).orElseThrow().getHolderCount()).isEqualTo(7);
        ((MemoryHoldings) holdings).reconcileCounts();
        assertThat(keywords.findById(a).orElseThrow().getHolderCount()).isEqualTo(1); // 이 키워드를 가진 사람은 한 명
        assertThat(players.findById(pid).orElseThrow().getHoldCount()).isEqualTo(1);   // 일반 키워드 하나
    }
}

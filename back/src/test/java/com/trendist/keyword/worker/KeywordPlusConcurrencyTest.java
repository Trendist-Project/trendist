package com.trendist.keyword.worker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.jayway.jsonpath.JsonPath;
import com.trendist.keyword.repository.KeywordRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/** + 를 키워드 워커(2a)에서 처리할 때의 동시성: 여러 사람이 같은 키워드를 동시에 더해도 보유 수와 행 수가 맞아야 한다. */
@SpringBootTest
@ActiveProfiles("test")
@AutoConfigureMockMvc
class KeywordPlusConcurrencyTest {
    @Autowired MockMvc mvc;
    @Autowired KeywordRepository keywords;
    @Autowired JdbcTemplate jdbc;
    /** 테스트 클래스들이 같은 DB를 공유하므로 닉네임이 겹치지 않게 번호를 붙인다 */
    private static final AtomicInteger SEQ = new AtomicInteger(10_000 + (int) (System.nanoTime() % 50_000));

    private String guestToken(String nickname) throws Exception {
        String token = JsonPath.read(mvc.perform(post("/api/auth/guest")).andReturn().getResponse().getContentAsString(), "$.accessToken");
        mvc.perform(post("/api/players").header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON)
                .content("{\"nickname\":\"" + nickname + "\"}"));
        return token;
    }

    private int plus(String token, String text) throws Exception {
        return mvc.perform(post("/api/keywords/plus").header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON)
                .content("{\"text\":\"" + text + "\"}")).andReturn().getResponse().getStatus();
    }

    @Test
    void manyPlayersPlusingTheSameNewKeywordAllSucceedAndCountsMatch() throws Exception {
        String text = "워커동시추가";
        List<String> tokens = new ArrayList<>();
        for (int i = 0; i < 12; i++) tokens.add(guestToken("워커" + SEQ.incrementAndGet()));

        ExecutorService pool = Executors.newFixedThreadPool(12);
        List<Future<Integer>> fs = new ArrayList<>();
        try {
            for (String t : tokens) fs.add(pool.submit(() -> plus(t, text)));
            int ok = 0;
            for (Future<Integer> f : fs) if (f.get() == 200) ok++;
            assertThat(ok).isEqualTo(12);
        } finally {
            pool.shutdown();
        }

        var k = keywords.findByCountryIdAndNormalized(1L, text).orElseThrow();
        Long holderRows = jdbc.queryForObject("select count(*) from player_keywords where keyword_id = ?", Long.class, k.getId());
        assertThat(holderRows).isEqualTo(12);
        assertThat(k.getHolderCount()).isEqualTo(12);
    }

    @Test
    void onePlayerPlusingTheSameKeywordManyTimesGetsExactlyOneSuccess() throws Exception {
        String token = guestToken("워커" + SEQ.incrementAndGet());
        String text = "워커중복추가";
        ExecutorService pool = Executors.newFixedThreadPool(6);
        List<Future<Integer>> fs = new ArrayList<>();
        try {
            for (int i = 0; i < 6; i++) fs.add(pool.submit(() -> plus(token, text)));
            int ok = 0, conflict = 0;
            for (Future<Integer> f : fs) {
                int s = f.get();
                if (s == 200) ok++;
                else if (s == 409) conflict++;
            }
            assertThat(ok).isEqualTo(1);
            assertThat(conflict).isEqualTo(5);
        } finally {
            pool.shutdown();
        }
        assertThat(mvc.perform(get("/api/me").header("Authorization", "Bearer " + token)).andReturn().getResponse().getStatus()).isEqualTo(200);
    }
}

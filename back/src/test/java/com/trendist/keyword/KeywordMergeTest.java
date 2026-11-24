package com.trendist.keyword;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.trendist.keyword.dto.KeywordDtos;
import com.trendist.keyword.entity.DataSource;
import com.trendist.keyword.repository.KeywordRepository;
import com.trendist.keyword.service.KeywordService;
import com.trendist.keyword.support.TrendFormula;
import com.trendist.setting.service.SettingService;
import com.trendist.setting.support.SettingKeys;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/** 키워드 합성(4.44): 합성 규칙, 보유 판정, 구성 원본 단위로 잃기, 금지 정리, 점수 식. */
@SpringBootTest
@ActiveProfiles("test")
@AutoConfigureMockMvc
class KeywordMergeTest {
    @Autowired MockMvc mvc;
    @Autowired KeywordService keywordService;
    @Autowired KeywordRepository keywords;
    @Autowired TrendFormula formula;
    @Autowired SettingService settings;
    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;

    @BeforeEach
    void noBonusByDefault() {
        settings.update(1, SettingKeys.MERGE_BONUS_BASE_PERCENT, "0"); // 확률 요소를 끄고 규칙만 본다
    }

    @AfterEach
    void restoreSettings() {
        settings.update(1, SettingKeys.MERGE_BONUS_BASE_PERCENT, "40");
        settings.update(1, SettingKeys.MERGE_BONUS_DECAY_PERCENT, "50");
    }

    // ---------------------------------------------------------------- 도우미

    private record Me(String token, long userId, long playerId) {}

    private Me player(String nickname) throws Exception {
        MvcResult g = mvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        String token = JsonPath.read(g.getResponse().getContentAsString(), "$.accessToken");
        mvc.perform(post("/api/players").header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content("{\"nickname\":\"" + nickname + "\"}")).andExpect(status().isOk());
        String me = mvc.perform(get("/api/me").header("Authorization", "Bearer " + token)).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return new Me(token, ((Number) JsonPath.read(me, "$.userId")).longValue(), ((Number) JsonPath.read(me, "$.player.id")).longValue());
    }

    /** 🔥활성 키워드를 만들고 번호를 돌려준다 */
    private long active(String text) {
        keywordService.applyExternalTitles("KR", DataSource.GOOGLE, List.of(text));
        return keywords.findByCountryIdAndNormalized(1L, text.replace(" ", "")).map(k -> k.getId()).orElseThrow();
    }

    private void plus(Me me, String text) throws Exception {
        mvc.perform(post("/api/keywords/plus").header("Authorization", "Bearer " + me.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"" + text + "\"}")).andExpect(status().isOk());
    }

    private long idOf(String text) { return keywords.findByCountryIdAndNormalized(1L, text).map(k -> k.getId()).orElseThrow(); }

    private KeywordDtos.MergePreview preview(Me me, long a, long b) {
        return keywordService.mergePreview(me.userId(), a, b);
    }

    private KeywordDtos.MergeResult merge(Me me, long a, long b) {
        return keywordService.merge(me.userId(), a, b);
    }

    private List<KeywordDtos.MyKeyword> box(Me me) { return keywordService.myKeywords(me.userId()); }

    private long holdCount(Me me) throws Exception {
        return ((Number) JsonPath.read(mvc.perform(get("/api/me").header("Authorization", "Bearer " + me.token()))
                .andReturn().getResponse().getContentAsString(), "$.player.holdCount")).longValue();
    }

    // ---------------------------------------------------------------- 점수 식

    @Test
    void lengthBonusAndNoCap() {
        assertThat(formula.trendValue(true, 50, 1, 100, 0)).isEqualTo(50);
        assertThat(formula.trendValue(true, 50, 1, 100, 5)).isEqualTo(55);   // 글자당 1점
        assertThat(formula.trendValue(true, 50, 2, 100, 20)).isEqualTo(120); // 100으로 자르지 않는다
        assertThat(formula.trendValue(true, 1, 1, 100, 5)).isEqualTo(10);    // 1명짜리 5글자: 5 + 5
        assertThat(formula.trendValue(false, 50, 1, 100, 20)).isZero();      // 💤는 가점도 없다
        assertThat(formula.mergedValue(110)).isEqualTo(220);                 // 구성 합 × 2
    }

    @Test
    void bonusChanceDropsAsStarsGrow() {
        assertThat(formula.mergeBonusPercent(2)).isEqualTo(0.0); // 이 테스트는 확률을 0으로 둔 상태
        settings.update(1, SettingKeys.MERGE_BONUS_BASE_PERCENT, "40");
        assertThat(formula.mergeBonusPercent(2)).isEqualTo(40.0);
        assertThat(formula.mergeBonusPercent(3)).isEqualTo(20.0);
        assertThat(formula.mergeBonusPercent(4)).isEqualTo(10.0);
        assertThat(formula.mergeBonusPercent(7)).isEqualTo(1.25);
    }

    // ---------------------------------------------------------------- 합성

    @Test
    void mergeCombinesTwoActiveKeywordsAndOrderDoesNotMatter() throws Exception {
        active("합성가가"); active("합성나나");
        Me me = player("합성러1");
        plus(me, "합성가가"); plus(me, "합성나나");
        long a = idOf("합성가가"), b = idOf("합성나나");
        long tvA = keywords.findById(a).orElseThrow().getTrendValue(), tvB = keywords.findById(b).orElseThrow().getTrendValue();

        // HTTP 경로도 확인한다(미리보기·합성·상세)
        mvc.perform(get("/api/me/keywords/merge-preview").param("a", String.valueOf(a)).param("b", String.valueOf(b))
                .header("Authorization", "Bearer " + me.token())).andExpect(status().isOk());
        var p1 = preview(me, a, b);
        var p2 = preview(me, b, a); // 앞뒤를 바꿔도 같은 결과
        assertThat(p1.ok()).isTrue();
        assertThat(p1.text()).isEqualTo("합성가가 + 합성나나").isEqualTo(p2.text());
        assertThat(p1.stars()).isEqualTo(2);
        assertThat(p1.score()).isEqualTo((tvA + tvB) * 2).isEqualTo(p2.score()); // 구성 합 × 배율 2
        assertThat(p1.expireHours()).isEqualTo(24);

        var r = merge(me, b, a);
        assertThat(r.bonus()).isFalse();
        assertThat(r.keyword().merged()).isTrue();
        assertThat(r.keyword().stars()).isEqualTo(2);
        assertThat(r.keyword().text()).isEqualTo("합성가가 + 합성나나");
        assertThat(r.keyword().trendValue()).isEqualTo((tvA + tvB) * 2);
        assertThat(r.keyword().expiresAt()).isBetween(Instant.now().plus(Duration.ofHours(23)), Instant.now().plus(Duration.ofHours(25)));
        assertThat(r.keyword().parts()).extracting(KeywordDtos.MergedPart::text).containsExactly("합성가가", "합성나나");
        assertThat(box(me)).hasSize(1); // 재료 둘은 보관함에서 빠진다
        assertThat(holdCount(me)).isEqualTo(2); // 보유 키워드 수는 구성 원본 수로 센다

        // 합성 키워드를 가지면 구성 원본도 가진 것: 직접 +할 수 없고, 구성 원본의 가진 사람 수는 그대로다
        mvc.perform(post("/api/keywords/plus").header("Authorization", "Bearer " + me.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"합성가가\"}")).andExpect(status().isConflict());
        assertThat(keywords.findById(a).orElseThrow().getHolderCount()).isEqualTo(1);

        // 합성 키워드는 검색으로 나오지 않는다(같은 글자를 검색해도 일반 키워드로 취급)
        String s = mvc.perform(get("/api/keywords/search").param("q", "합성가가합성나나").header("Authorization", "Bearer " + me.token()))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat((String) JsonPath.read(s, "$.status")).isEqualTo("NEW");

        // 같은 조합은 누가 만들어도 같은 합성 키워드 한 행으로 묶인다
        Me other = player("합성러2");
        plus(other, "합성나나"); plus(other, "합성가가");
        var r2 = merge(other, idOf("합성가가"), idOf("합성나나"));
        assertThat(r2.keyword().keywordId()).isEqualTo(r.keyword().keywordId());
        assertThat(keywords.findById(r.keyword().keywordId()).orElseThrow().getHolderCount()).isEqualTo(2);
        assertThat(keywords.findById(a).orElseThrow().getHolderCount()).isEqualTo(2);

        // 합성 키워드 상세 창: 구성 원본 카드가 모두 들어 있다
        mvc.perform(get("/api/keywords/merged/{id}", r.keyword().keywordId()).header("Authorization", "Bearer " + me.token())).andExpect(status().isOk());
        var detail = keywordService.mergedDetail(me.userId(), r.keyword().keywordId());
        assertThat(detail.parts()).hasSize(2);
        assertThat(detail.parts().get(0).plusedByMe()).isTrue();
        assertThat(detail.myExpiresAt()).isNotNull();
    }

    @Test
    void onlyActiveKeywordsAndFittingLengthCanBeMerged() throws Exception {
        active("활성합성감");
        Me me = player("합성러3");
        plus(me, "아직비활성키워드"); // 첫 +는 💤
        plus(me, "활성합성감");
        var inactive = preview(me, idOf("아직비활성키워드"), idOf("활성합성감"));
        assertThat(inactive.ok()).isFalse();
        assertThat(inactive.reason()).contains("활성");

        active("가나다라마바사아자차카"); active("하하하하하하하하하하하"); // 11자 + 11자 = 22자
        plus(me, "가나다라마바사아자차카"); plus(me, "하하하하하하하하하하하");
        var tooLong = preview(me, idOf("가나다라마바사아자차카"), idOf("하하하하하하하하하하하"));
        assertThat(tooLong.ok()).isFalse();
        assertThat(tooLong.reason()).contains("2자를 초과합니다");
    }

    @Test
    void mergedKeywordsCanBeMergedAgainAndOverlapIsRejected() throws Exception {
        active("삼성가"); active("삼성나"); active("삼성다"); active("삼성라");
        Me me = player("합성러4");
        for (String t : List.of("삼성가", "삼성나", "삼성다", "삼성라")) plus(me, t);
        long ab = merge(me, idOf("삼성가"), idOf("삼성나")).keyword().keywordId();
        var three = merge(me, ab, idOf("삼성다"));            // 2성 + 1 = 3성
        assertThat(three.keyword().stars()).isEqualTo(3);
        assertThat(three.keyword().text()).isEqualTo("삼성가 + 삼성나 + 삼성다");
        long cd = idOf("삼성라");
        var overlapSame = preview(me, three.keyword().keywordId(), cd);
        assertThat(overlapSame.ok()).isTrue();                  // 3성 + 1 = 4성
        assertThat(overlapSame.stars()).isEqualTo(4);
        assertThat(holdCount(me)).isEqualTo(4);

        // 구성 원본이 겹치는 합성: 다른 사람이 가나 합성(2성)과 나다 합성(2성)을 가졌으면 합칠 수 없다
        Me other = player("합성러5");
        active("겹침가"); active("겹침나"); active("겹침다");
        for (String t : List.of("겹침가", "겹침나", "겹침다")) plus(other, t);
        long x = merge(other, idOf("겹침가"), idOf("겹침나")).keyword().keywordId();
        mvc.perform(post("/api/keywords/plus").header("Authorization", "Bearer " + other.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"겹침가\"}")).andExpect(status().isConflict());
        var same = preview(other, x, x);
        assertThat(same.ok()).isFalse();
    }

    @Test
    void bonusAddsOneStarFromAnActiveKeywordThatFits() throws Exception {
        active("보너스재료가"); active("보너스재료나"); active("보너스후보짧");
        settings.update(1, SettingKeys.MERGE_BONUS_BASE_PERCENT, "100"); // 2성 결과는 반드시 보너스(후보가 있으면)
        Me me = player("합성러6");
        plus(me, "보너스재료가"); plus(me, "보너스재료나");
        var pv = preview(me, idOf("보너스재료가"), idOf("보너스재료나"));
        assertThat(pv.bonusPercent()).isEqualTo(100.0);
        assertThat(pv.bonusPossible()).isTrue();
        var r = merge(me, idOf("보너스재료가"), idOf("보너스재료나"));
        assertThat(r.bonus()).isTrue();
        assertThat(r.keyword().stars()).isEqualTo(3);
        assertThat(r.bonusPart()).isNotNull();
        assertThat(r.bonusPart().text()).isNotIn("보너스재료가", "보너스재료나");
        assertThat(r.keyword().text().replace(" + ", "").length()).isLessThanOrEqualTo(20); // " + " 구분은 표시용이라 글자 수에 세지 않는다
        assertThat(r.keyword().parts()).hasSize(3);
        assertThat(holdCount(me)).isEqualTo(3); // 덤으로 붙은 키워드도 가진 것
        assertThat(keywords.findById(r.bonusPart().keywordId()).orElseThrow().getHolderCount()).isPositive();
    }

    // ---------------------------------------------------------------- 잃기·금지

    @Test
    void collisionLosesOnlyOneOriginalFromMergedKeyword() throws Exception {
        active("충돌합가"); active("충돌합나");
        Me loser = player("합성뺏김"), winner = player("합성뺏음");
        plus(loser, "충돌합가"); plus(loser, "충돌합나");
        long a = idOf("충돌합가"), b = idOf("충돌합나");
        var merged = merge(loser, a, b);
        Instant expires = merged.keyword().expiresAt();

        var stolen = keywordService.stealRandom(loser.playerId(), winner.playerId()).orElseThrow();
        assertThat(stolen.result()).isEqualTo("ADDED");
        assertThat(stolen.text()).isIn("충돌합가", "충돌합나"); // 합성 키워드가 아니라 원본 하나를 빼앗는다

        // 진 사람: 합성이 풀려 남은 원본 하나(일반 키워드)가 남고 남은 시간은 그대로다
        var left = box(loser);
        assertThat(left).hasSize(1);
        assertThat(left.get(0).merged()).isFalse();
        assertThat(left.get(0).text()).isNotEqualTo(stolen.text());
        assertThat(Duration.between(left.get(0).expiresAt(), expires).abs()).isLessThan(Duration.ofSeconds(1));
        assertThat(holdCount(loser)).isEqualTo(1);
        // 이긴 사람: 일반 키워드로 받는다
        var got = box(winner);
        assertThat(got).hasSize(1);
        assertThat(got.get(0).text()).isEqualTo(stolen.text());
        assertThat(got.get(0).merged()).isFalse();
        // 가진 사람 수: 빼앗긴 원본은 이긴 사람 1명, 남은 원본은 진 사람 1명
        assertThat(keywords.findById(idOf(stolen.text().equals("충돌합가") ? "충돌합가" : "충돌합나")).orElseThrow().getHolderCount()).isEqualTo(1);
        assertThat(keywords.findById(merged.keyword().keywordId()).orElseThrow().getHolderCount()).isZero();

        // 일반 키워드가 뽑히면 기존과 같이 동작한다
        var second = keywordService.stealRandom(loser.playerId(), winner.playerId()).orElseThrow();
        assertThat(second.text()).isNotEqualTo(stolen.text());
        assertThat(box(loser)).isEmpty();
    }

    @Test
    void threeStarMergedKeywordBecomesTwoStarWhenOneOriginalIsLost() throws Exception {
        active("삼성합가"); active("삼성합나"); active("삼성합다");
        Me loser = player("삼성뺏김"), winner = player("삼성뺏음");
        for (String t : List.of("삼성합가", "삼성합나", "삼성합다")) plus(loser, t);
        var m1 = merge(loser, idOf("삼성합가"), idOf("삼성합나"));
        var m2 = merge(loser, m1.keyword().keywordId(), idOf("삼성합다"));
        assertThat(m2.keyword().stars()).isEqualTo(3);

        var lost = keywordService.loseRandom(loser.playerId()).orElseThrow();
        assertThat(lost.text()).isIn("삼성합가", "삼성합나", "삼성합다");
        var left = box(loser);
        assertThat(left).hasSize(1);
        assertThat(left.get(0).merged()).isTrue();
        assertThat(left.get(0).stars()).isEqualTo(2); // 성이 하나 낮아진다
        assertThat(left.get(0).parts()).extracting(KeywordDtos.MergedPart::text).doesNotContain(lost.text());
        assertThat(Duration.between(left.get(0).expiresAt(), m2.keyword().expiresAt()).abs()).isLessThan(Duration.ofSeconds(1)); // 남은 시간 유지
        assertThat(holdCount(loser)).isEqualTo(2);
        assertThat(lost.score()).isPositive(); // 실제로 줄어든 유행도
    }

    @Test
    void bannedOriginalLeavesTheMergedKeyword() throws Exception {
        active("금지합가"); active("금지합나");
        Me me = player("합성러7");
        plus(me, "금지합가"); plus(me, "금지합나");
        merge(me, idOf("금지합가"), idOf("금지합나"));
        assertThat(box(me).get(0).stars()).isEqualTo(2);

        keywordService.adminBan(idOf("금지합가"), true); // 금지: 커밋 뒤 모든 보관함에서 정리한다
        var left = box(me);
        assertThat(left).hasSize(1);
        assertThat(left.get(0).merged()).isFalse();
        assertThat(left.get(0).text()).isEqualTo("금지합나");
        assertThat(holdCount(me)).isEqualTo(1);
    }

    @Test
    void expiredMergedKeywordReleasesItsOriginals() throws Exception {
        active("만료합가"); active("만료합나");
        Me me = player("합성러8");
        plus(me, "만료합가"); plus(me, "만료합나");
        var r = merge(me, idOf("만료합가"), idOf("만료합나"));
        assertThat(keywords.findById(idOf("만료합가")).orElseThrow().getHolderCount()).isEqualTo(1);
        // 만료 시각을 과거로 돌리고 만료 처리: 구성 원본의 가진 사람 수와 보유 키워드 수가 줄어든다
        jdbc.update("update player_keywords set expires_at = ? where player_id = ? and keyword_id = ?",
                java.sql.Timestamp.from(Instant.now().minusSeconds(60)), me.playerId(), r.keyword().keywordId());
        Long rowId = jdbc.queryForObject("select id from player_keywords where player_id = ? and keyword_id = ?", Long.class,
                me.playerId(), r.keyword().keywordId());
        assertThat(keywordService.expireOne(rowId)).isTrue();
        assertThat(keywords.findById(idOf("만료합가")).orElseThrow().getHolderCount()).isZero();
        assertThat(keywords.findById(idOf("만료합나")).orElseThrow().getHolderCount()).isZero();
        assertThat(keywords.findById(r.keyword().keywordId()).orElseThrow().getHolderCount()).isZero();
        assertThat(box(me)).isEmpty();
        assertThat(holdCount(me)).isZero();
        // 원본을 다시 +할 수 있다
        plus(me, "만료합가");
    }

    @Test
    void gradeBaseIsTheHighestScoreOfASingleKeyword() throws Exception {
        // 노멀의 끝 = 최대 기준값 50 × 가중치 1 + 20자 × 글자 가점 1 = 70, 그 위 등급은 배수
        Me me = player("등급러");
        mvc.perform(get("/api/keywords/grades").header("Authorization", "Bearer " + me.token())).andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.normalMax").value(70))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.mins[0]").value(71))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.mins[1]").value(140))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.mins[4]").value(1120));
        assertThat(formula.trendValue(true, 50, 1, 100, 20)).isEqualTo(70); // 일반 키워드 한 개의 이론상 최고점
    }

    @Test
    void deathLosesByOriginalCountNotByItem() throws Exception {
        // 죽음·불꽃으로 잃을 때도 합성 키워드는 구성 원본 수로 센다: 일반 2개 + 2성 합성(원본 2개) = 원본 4개의 50% = 2개
        for (String t : List.of("죽음합가", "죽음합나", "죽음합다", "죽음합라")) active(t);
        Me me = player("합성죽음");
        for (String t : List.of("죽음합가", "죽음합나", "죽음합다", "죽음합라")) plus(me, t);
        merge(me, idOf("죽음합가"), idOf("죽음합나"));
        assertThat(holdCount(me)).isEqualTo(4);
        var lost = keywordService.loseFraction(me.playerId(), 50).orElseThrow();
        assertThat(lost.count()).isEqualTo(2);
        assertThat(holdCount(me)).isEqualTo(2); // 원본 2개가 남는다(합성 키워드를 통째로 잃어도 2개, 원본만 빠져도 2개)
        assertThat(box(me).stream().mapToInt(KeywordDtos.MyKeyword::stars).sum()).isEqualTo(2);
    }

    @Test
    void loseAllCountsOriginals() throws Exception {
        for (String t : List.of("모두합가", "모두합나", "모두합다")) active(t);
        Me me = player("합성모두");
        for (String t : List.of("모두합가", "모두합나", "모두합다")) plus(me, t);
        merge(me, idOf("모두합가"), idOf("모두합나"));
        var lost = keywordService.loseAll(me.playerId()).orElseThrow();
        assertThat(lost.count()).isEqualTo(3); // 합성 키워드는 원본 2개로 센다
        assertThat(box(me)).isEmpty();
        assertThat(holdCount(me)).isZero();
        assertThat(keywords.findById(idOf("모두합가")).orElseThrow().getHolderCount()).isZero();
    }

    @Test
    void inactiveOriginalIsSplitOutOfMergedKeywords() throws Exception {
        // 원본이 💤가 되면(외부 데이터가 사라지고 가진 사람 3명 미만) 합성 키워드에서 그 원본이 빠지고 성이 낮아진다
        active("분리합가"); active("분리합나"); active("분리합다");
        Me me = player("합성분리");
        for (String t : List.of("분리합가", "분리합나", "분리합다")) plus(me, t);
        var m1 = merge(me, idOf("분리합가"), idOf("분리합나"));
        var m2 = merge(me, m1.keyword().keywordId(), idOf("분리합다"));
        assertThat(m2.keyword().stars()).isEqualTo(3);
        long target = idOf("분리합가");
        // 외부 유지 기간이 끝났고 목록에서 빠졌다고 치고 💤로 내린다(가진 사람은 이 플레이어 1명뿐이라 3명 미만)
        jdbc.update("update keywords set external_until = ? where id = ?", java.sql.Timestamp.from(Instant.now().minusSeconds(5)), target);
        assertThat(keywordService.expireExternal(DataSource.GOOGLE, java.util.Set.of())).isPositive();
        var left = box(me);
        assertThat(left).hasSize(1);
        assertThat(left.get(0).merged()).isTrue();
        assertThat(left.get(0).stars()).isEqualTo(2);                 // 3성 → 2성
        assertThat(left.get(0).parts()).extracting(KeywordDtos.MergedPart::text).containsExactly("분리합나", "분리합다");
        assertThat(holdCount(me)).isEqualTo(2);
        assertThat(keywords.findById(target).orElseThrow().getHolderCount()).isZero();
    }
}

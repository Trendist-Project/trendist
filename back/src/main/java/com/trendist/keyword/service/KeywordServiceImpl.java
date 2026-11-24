package com.trendist.keyword.service;

import com.trendist.common.code.CodeTables;
import com.trendist.common.exception.ApiException;
import com.trendist.country.entity.Country;
import com.trendist.country.service.CountryService;
import com.trendist.game.event.GameEvents;
import com.trendist.keyword.dto.KeywordDtos;
import com.trendist.keyword.entity.DataSource;
import com.trendist.keyword.entity.Keyword;
import com.trendist.keyword.entity.KeywordMergePart;
import com.trendist.keyword.entity.KeywordState;
import com.trendist.keyword.entity.PlayerKeyword;
import com.trendist.keyword.repository.KeywordMergePartRepository;
import com.trendist.keyword.repository.KeywordRepository;
import com.trendist.keyword.source.ExternalTrendSource;
import com.trendist.keyword.support.ActivePopulation;
import com.trendist.keyword.support.BannedWordFilter;
import com.trendist.keyword.support.KeywordNormalizer;
import com.trendist.keyword.support.MergeKey;
import com.trendist.keyword.support.SearchCounter;
import com.trendist.keyword.support.TrendFormula;
import com.trendist.player.entity.Player;
import com.trendist.player.repository.PlayerRepository;
import com.trendist.player.service.PlayerService;
import com.trendist.setting.service.SettingService;
import com.trendist.setting.support.SettingKeys;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import com.trendist.keyword.repository.KeywordAiRequestRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Sort;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/** 검색, +, 보관함, 만료, 충돌로 잃기(4.4~4.8, 9.4). */
@Service
@RequiredArgsConstructor
public class KeywordServiceImpl implements KeywordService {
    private static final Logger log = LoggerFactory.getLogger(KeywordServiceImpl.class);
    private final KeywordRepository keywords;
    private final BannedWordFilter bannedWords;
    private final KeywordAiRequestRepository aiRequests;
    private final com.trendist.keyword.holding.Holdings holdings;
    private final KeywordMergePartRepository mergeParts;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc; // 자동 합성의 구성 원본 행을 한 번에 넣는 데 쓴다
    private final com.trendist.keyword.memory.HoldingsStore holdingsStore; // 합성 키워드의 구성 원본을 한 번 읽으면 기억해 두는 곳(구성은 바뀌지 않는다)
    private final PlayerRepository players;
    private final PlayerService playerService;
    private final TrendFormula formula;
    private final ActivePopulation population;
    private final SettingService settings;
    private final CodeTables codes;
    private final List<ExternalTrendSource> sources;
    private final SearchCounter searchCounter;
    private final com.trendist.keyword.support.KeywordViewCounter viewCounter;
    private final ApplicationEventPublisher events;
    private final TransactionTemplate tx;
    private final CountryService countries;
    private final Clock clock;
    private final com.trendist.stats.support.ActivityCounter activity;

    /** 트렌드 값이 바뀐 키워드. 1분 잡이 보유자 점수를 DB에서 다시 합산한다(9.4). */
    private final Set<Long> dirtyKeywords = ConcurrentHashMap.newKeySet();

    // ---------------------------------------------------------------- 검색

    @Override
    @Transactional
    public KeywordDtos.SearchResult search(long userId, String q) {
        Player p = playerService.requireCurrent(userId);
        String text = KeywordNormalizer.display(q);
        String normalized = KeywordNormalizer.validate(text);
        // 검색할 때마다 플레이어의 검색수 +1(찾았는지·금지인지와 관계없이). 형식에 맞지 않아 거절된 입력은 세지 않는다
        players.incSearchCount(p.getId());
        activity.add(p.getCountry().getId(), com.trendist.stats.support.ActivityCounter.Kind.SEARCH); // 사이트 통계(13.9)
        events.publishEvent(new GameEvents.TitleCheck(p.getId())); // 검색 칭호(4.10)
        Country country = p.getCountry();
        Instant now = Instant.now(clock);

        if (bannedWords.contains(country.getCode(), normalized)) return new KeywordDtos.SearchResult("BANNED", null); // 금지어가 들어 있으면 막는다(4.6)
        Optional<Keyword> found = keywords.findByCountryIdAndNormalized(country.getId(), normalized);
        if (found.isPresent()) {
            Keyword k = found.get();
            if (isBanned(k)) return new KeywordDtos.SearchResult("BANNED", null);
            if (isState(k, CodeTables.KW_INACTIVE)) tryExternalActivate(k, now); // 💤는 외부를 다시 조회한다
            searchCounter.count(userId, k.getId());
            return new KeywordDtos.SearchResult("FOUND", card(k, p, now));
        }
        // DB에 없음: 외부에서 확인되면 🔥로 등록, 아니면 등록하지 않고 💤 카드만 보여 준다(첫 + 때 만든다)
        Optional<Confirmed> ext = externalConfirm(country.getCode(), normalized);
        if (ext.isPresent()) {
            Keyword k = createKeyword(country, text, normalized, ext, now);
            searchCounter.count(userId, k.getId());
            return new KeywordDtos.SearchResult("FOUND", card(k, p, now));
        }
        var preview = new KeywordDtos.KeywordCard(null, text, CodeTables.KW_INACTIVE, 0,
                0, 0, 0, 0, false, null, null, false);
        return new KeywordDtos.SearchResult("NEW", preview);
    }

    // ---------------------------------------------------------------- +

    @Override
    @Transactional
    public KeywordDtos.PlusResult plus(long userId, String rawText) {
        Player found = playerService.requireCurrent(userId);
        Player p = players.findByIdForUpdate(found.getId()).orElseThrow(); // 잠금 순서: 플레이어 → 키워드
        String text = KeywordNormalizer.display(rawText);
        String normalized = KeywordNormalizer.validate(text);
        Instant now = Instant.now(clock);
        Country country = p.getCountry();
        if (bannedWords.contains(country.getCode(), normalized)) throw ApiException.badRequest("KEYWORD_BANNED", "검색할 수 없는 키워드예요"); // 금지어가 들어 있으면 만들지도 않는다

        Keyword k = keywords.findByCountryIdAndNormalized(country.getId(), normalized)
                .orElseGet(() -> createKeyword(country, text, normalized, externalConfirm(country.getCode(), normalized), now));
        k = keywords.findByIdForUpdate(k.getId()).orElseThrow();
        if (isBanned(k)) throw ApiException.badRequest("KEYWORD_BANNED", "검색할 수 없는 키워드예요");

        Optional<PlayerKeyword> existing = holdings.findByPlayerIdAndKeywordId(p.getId(), k.getId());
        if (existing.isPresent() && !existing.get().isExpired(now)) throw ApiException.conflict("ALREADY_PLUSED", "이미 보유중인 키워드예요");
        if (covering(p.getId(), k.getId(), now).isPresent()) throw ApiException.conflict("ALREADY_PLUSED", "이미 보유중인 키워드예요"); // 합성 키워드로 가진 원본(4.44)
        activity.add(country.getId(), com.trendist.stats.support.ActivityCounter.Kind.PLUS); // 사이트 통계(13.9)
        return addHolding(p, k, existing, now);
    }

    /** +의 본체: 보관함에 넣고 인원·EXP·트렌드 값·점수를 고친다. 플레이어와 키워드 행을 잠근 상태에서 부른다. */
    private KeywordDtos.PlusResult addHolding(Player p, Keyword k, Optional<PlayerKeyword> existing, Instant now) {
        Added a = addHoldingCore(p, k, existing, now);
        return new KeywordDtos.PlusResult(card(k, p, now), a.gained(), playerService.summary(p));
    }

    /** 키워드를 더한 결과(카드·요약 없이 값만): 얻은 점수, 새 만료 시각 */
    private record Added(long gained, Instant expires) {}

    /** 키워드를 보관함에 더하고 점수·이벤트를 처리한다. 카드·요약은 만들지 않아(구슬처럼 값만 필요한 곳은 이 값으로 충분하다) 조회가 적다. */
    private Added addHoldingCore(Player p, Keyword k, Optional<PlayerKeyword> existing, Instant now) {
        Instant expires = now.plus(Duration.ofHours(settings.getInt(SettingKeys.PLUS_TTL_HOURS)));
        Country country = p.getCountry();
        long oldTrend = k.getTrendValue();
        long oldScore = p.getCurrentScore() - p.getLevel(); // 레벨은 유행도에 1:1로 더해지는데 "얻은 점수"에는 키워드 몫만 센다(레벨이 올라도 늘어난 것으로 보이지 않게)
        boolean newHolder;
        if (existing.isPresent()) {
            existing.get().renew(now, expires); // 만료 행 재사용: 가진 사람 수는 그대로
            newHolder = false;
        } else {
            holdings.save(new PlayerKeyword(p, k, now, expires));
            k.incHolder();
            p.incHold();
            newHolder = true;
        }
        k.incAdd();
        p.incAdd();
        p.addExp(settings.getInt(SettingKeys.EXP_PER_PLUS)); // EXP는 💤 키워드에도 바로 준다(4.9)
        p.touchPlayed(now, ZoneId.of(p.getCountry().getTimezone())); // 활동한 날 칭호(4.10)

        if (isState(k, CodeTables.KW_INACTIVE) && k.getHolderCount() >= settings.getInt(SettingKeys.ACTIVATE_HOLDERS)) {
            k.activate(codes.keywordState(CodeTables.KW_ACTIVE), now); // 내부 확산으로 활성(4.6)
            activeIdCache.remove(k.getCountry().getId()); // 구슬 후보 목록에 바로 반영
        }
        long newTrend = updateTrend(k);
        keywords.flush();
        holdings.flush();
        long newScore = playerService.recompute(p);
        long gainedScore = newScore - p.getLevel() - oldScore;
        publishTrendChange(k, oldTrend, newTrend, p.getId());
        if (newHolder) {
            events.publishEvent(new GameEvents.HoldingChanged(country.getId(), p.getId(), k.getId(), true));
            // 체력 회복(4.36): 새로 얻은 키워드의 점수와 얻은 뒤의 내 유행도(💤 키워드는 점수 0이라 회복도 없다)
            events.publishEvent(new GameEvents.KeywordGained(country.getId(), p.getId(), isState(k, CodeTables.KW_ACTIVE) ? newTrend : 0, newScore));
        }
        return new Added(gainedScore, expires);
    }

    /** 이미 가진 키워드의 만료 시각만 지금부터 다시 `plus_ttl_hours`(기본 24시간)로 늘린다. 점수·EXP는 그대로(4.3, 4.20, 4.21). 새 만료 시각을 돌려준다 */
    private Instant renewHolding(PlayerKeyword pk, Instant now) {
        int hours = pk.getKeyword().isMerged() ? settings.getInt(SettingKeys.MERGE_EXPIRE_HOURS) : settings.getInt(SettingKeys.PLUS_TTL_HOURS);
        Instant expires = now.plus(Duration.ofHours(hours));
        pk.renew(now, expires);
        holdings.flush();
        return expires;
    }

    // ---------------------------------------------------------------- 구슬(4.20)

    @Override
    @Transactional
    public KeywordDtos.OrbResult openOrb(long playerId) {
        return openOrb(playerId, false, true);
    }

    @Override
    @Transactional
    public KeywordDtos.OrbResult openPrizeOrb(long playerId) {
        return openOrb(playerId, true, true);
    }

    @Override
    @Transactional
    public KeywordDtos.OrbResult grantRewardKeyword(long playerId) {
        return openOrb(playerId, true, false);
    }

    @Override
    @Transactional
    public List<KeywordDtos.OrbResult> openPrizeOrbs(long playerId, int count) {
        List<KeywordDtos.OrbResult> out = new ArrayList<>(count);
        if (count <= 0) return out;
        Player p = players.findByIdForUpdate(playerId).orElse(null);
        KeywordDtos.OrbResult none = new KeywordDtos.OrbResult("NONE", null, null, null, 0, null, null);
        if (p == null) { for (int i = 0; i < count; i++) out.add(none); return out; }
        Country country = p.getCountry();
        long countryId = country.getId();
        Instant now = Instant.now(clock);
        for (int i = 0; i < count; i++) { // 먹은 횟수는 구슬마다 센다(칭호, 사이트 통계)
            activity.add(countryId, com.trendist.stats.support.ActivityCounter.Kind.ORB);
            p.incOrb();
        }
        events.publishEvent(new GameEvents.TitleCheck(p.getId()));
        List<Long> ids = activeIds(countryId, false);
        if (ids.isEmpty()) { for (int i = 0; i < count; i++) out.add(none); return out; }

        // 안 가진 키워드를 먼저 고르고(구슬마다 하나씩), 모자라면 이미 가진 키워드의 시간만 갱신한다
        Set<Long> held = heldCoveredIds(p.getId(), now);
        List<Long> fresh = new ArrayList<>(ids.stream().filter(id -> !held.contains(id)).toList());
        Collections.shuffle(fresh, ThreadLocalRandom.current());
        int gainN = Math.min(count, fresh.size());
        List<Long> gainIds = new ArrayList<>(fresh.subList(0, gainN));
        List<Long> renewIds = new ArrayList<>();
        for (int i = gainN; i < count; i++) renewIds.add(ids.get(ThreadLocalRandom.current().nextInt(ids.size())));

        Set<Long> allIds = new TreeSet<>(gainIds);
        allIds.addAll(renewIds);
        Map<Long, Keyword> byId = new HashMap<>();
        for (Keyword k : keywords.findAllByIdForUpdate(allIds)) byId.put(k.getId(), k); // 번호 순으로 한 번에 잠근다
        Map<Long, PlayerKeyword> rowOf = new HashMap<>();
        for (PlayerKeyword pk : holdings.findByPlayerIdAndKeywordIdIn(p.getId(), allIds)) rowOf.put(pk.getKeyword().getId(), pk);

        Instant expires = now.plus(Duration.ofHours(settings.getInt(SettingKeys.PLUS_TTL_HOURS)));
        long oldScore = p.getCurrentScore() - p.getLevel();
        Map<Long, long[]> trendChange = new LinkedHashMap<>(); // {old, new}
        Set<Long> newHolderIds = new HashSet<>();
        for (Long id : gainIds) {
            Keyword k = byId.get(id);
            if (k == null) continue;
            PlayerKeyword pk = rowOf.get(id);
            long oldTrend = k.getTrendValue();
            if (pk == null) { holdings.save(new PlayerKeyword(p, k, now, expires)); k.incHolder(); newHolderIds.add(id); }
            else pk.renew(now, expires); // 만료 행 재사용: 가진 사람 수는 그대로
            k.incAdd();
            trendChange.put(id, new long[]{oldTrend, updateTrend(k)});
        }
        for (Long id : renewIds) {
            PlayerKeyword pk = rowOf.get(id);
            if (pk != null && !pk.isExpired(now)) pk.renew(now, expires); // 직접 가진 행만 갱신(합성 키워드 안의 원본은 그대로)
        }
        keywords.flush();
        holdings.flush();

        // 플레이어: 얻은 구슬 수만큼 추가·EXP, 새로 가진 수만큼 보유(키워드를 얻은 구슬만 센다)
        int newHolders = newHolderIds.size();
        for (int i = 0; i < gainIds.size(); i++) { p.incAdd(); p.addExp(settings.getInt(SettingKeys.EXP_PER_PLUS)); }
        for (int i = 0; i < newHolders; i++) p.incHold();
        if (!gainIds.isEmpty()) p.touchPlayed(now, ZoneId.of(p.getCountry().getTimezone()));
        long newScore = playerService.recompute(p); // 위 묶음 SQL이 반영된 합으로 한 번만 다시 계산한다
        long totalGained = newScore - p.getLevel() - oldScore;

        for (Map.Entry<Long, long[]> e : trendChange.entrySet()) {
            dirtyKeywords.add(e.getKey());
            long delta = e.getValue()[1] - e.getValue()[0];
            if (delta != 0) events.publishEvent(new GameEvents.KeywordTrendChanged(countryId, e.getKey(), delta, p.getId()));
        }
        // 결과: 구슬마다 하나(먹은 순서대로). 키워드를 얻은 구슬은 그 키워드의 점수를, 나머지 점수 변화(EXP·레벨)는 마지막 얻은 구슬에 얹는다
        long sumGain = 0;
        List<KeywordDtos.OrbResult> gains = new ArrayList<>();
        for (Long id : gainIds) {
            Keyword k = byId.get(id);
            if (k == null) { gains.add(none); continue; }
            long nt = trendChange.get(id)[1];
            long g = isState(k, CodeTables.KW_ACTIVE) ? nt : 0;
            sumGain += g;
            boolean newHolder = newHolderIds.contains(id);
            gains.add(new KeywordDtos.OrbResult("GAINED", k.getText(), k.getKeywordState().getName(), nt, k.getHolderCount(), g, expires, id));
            if (newHolder) {
                events.publishEvent(new GameEvents.HoldingChanged(countryId, p.getId(), id, true));
                events.publishEvent(new GameEvents.KeywordGained(countryId, p.getId(), isState(k, CodeTables.KW_ACTIVE) ? nt : 0, newScore)); // 체력 회복(4.36)
            }
        }
        if (!gains.isEmpty()) {
            int last = gains.size() - 1;
            KeywordDtos.OrbResult l = gains.get(last);
            if (l.keywordId() != null) gains.set(last, new KeywordDtos.OrbResult(l.status(), l.text(), l.state(), l.trendValue(), l.holderCount(), l.gained() + (totalGained - sumGain), l.expiresAt(), l.keywordId()));
        }
        out.addAll(gains);
        for (Long id : renewIds) {
            Keyword k = byId.get(id);
            if (k == null) { out.add(none); continue; }
            out.add(new KeywordDtos.OrbResult("RENEWED", k.getText(), k.getKeywordState().getName(), k.getTrendValue(), k.getHolderCount(), 0L, expires, id));
        }
        return out;
    }

    private KeywordDtos.OrbResult openOrb(long playerId, boolean prize, boolean countOrb) {
        Player p = players.findByIdForUpdate(playerId).orElse(null);
        if (p == null) return new KeywordDtos.OrbResult("NONE", null, null, null, 0, null, null);
        return openOrbFor(p, prize, countOrb);
    }

    /** 이미 잠근 플레이어 p의 구슬 하나를 처리한다 */
    private KeywordDtos.OrbResult openOrbFor(Player p, boolean prize, boolean countOrb) {
        if (countOrb) {
            activity.add(p.getCountry().getId(), com.trendist.stats.support.ActivityCounter.Kind.ORB); // 사이트 통계(13.9)
            p.incOrb(); // 꽝이어도 먹은 횟수는 센다(칭호, 4.10). 보스 보상 키워드는 구슬이 아니라 세지 않는다
        }
        events.publishEvent(new GameEvents.TitleCheck(p.getId()));
        // ? 구슬: 설정 확률(기본 60%)로 🔥활성 키워드를 얻고, 나머지는 내 키워드 하나를 잃는다(없으면 꽝). ! 구슬(prize)은 항상 얻는다
        if (!prize && ThreadLocalRandom.current().nextDouble(100) >= settings.getDouble(SettingKeys.ORB_ACTIVE_PERCENT)) {
            return loseFromOrb(p);
        }
        Instant now = Instant.now(clock);
        List<Long> ids = activeIds(p.getCountry().getId(), false);
        if (prize && ids.size() > 1) {
            // 꽝 없이 "얻는" 구슬이므로, 가능하면 내 보관함에 없는 키워드에서 고른다(이미 가진 키워드면 시간만 갱신돼 얻은 느낌이 없다)
            Set<Long> held = heldCoveredIds(p.getId(), Instant.now(clock)); // 합성으로 가진 원본도 가진 것(4.44)
            List<Long> fresh = ids.stream().filter(id -> !held.contains(id)).toList();
            if (!fresh.isEmpty()) ids = fresh;
        }
        if (ids.isEmpty()) return new KeywordDtos.OrbResult("NONE", null, null, null, 0, null, null);
        Keyword k = keywords.findByIdForUpdate(ids.get(ThreadLocalRandom.current().nextInt(ids.size()))).orElseThrow();
        if (!isState(k, CodeTables.KW_ACTIVE)) { // 목록은 몇 초 전 값이라 그 사이 💤·금지가 됐을 수 있다: 목록을 새로 읽어 다시 고른다
            ids = activeIds(p.getCountry().getId(), true);
            if (ids.isEmpty()) return new KeywordDtos.OrbResult("NONE", null, null, null, 0, null, null);
            k = keywords.findByIdForUpdate(ids.get(ThreadLocalRandom.current().nextInt(ids.size()))).orElseThrow();
        }
        Optional<PlayerKeyword> existing = holdings.findByPlayerIdAndKeywordId(p.getId(), k.getId());
        Optional<PlayerKeyword> holding = covering(p.getId(), k.getId(), now); // 합성 키워드로 가진 것도 이미 가진 것(4.44)
        if (holding.isPresent()) {
            // 이미 보관함에 있는 키워드가 나오면 남은 시간만 지금부터 다시 24시간(사람에게서 빼앗을 때(4.3)와 같게). 점수·EXP는 그대로
            return new KeywordDtos.OrbResult("RENEWED", k.getText(), k.getKeywordState().getName(), k.getTrendValue(),
                    k.getHolderCount(), 0L, renewHolding(holding.get(), now), k.getId());
        }
        Added r = addHoldingCore(p, k, existing, now);
        return new KeywordDtos.OrbResult("GAINED", k.getText(), k.getKeywordState().getName(), k.getTrendValue(),
                k.getHolderCount(), r.gained(), r.expires(), k.getId());
    }

    /** 나라의 🔥활성 일반 키워드 번호 목록과 읽은 시각 */
    private record ActiveIds(List<Long> ids, long at) {}
    private static final long ACTIVE_IDS_TTL_MS = 5_000;
    private final Map<Long, ActiveIds> activeIdCache = new ConcurrentHashMap<>();

    /**
     * 구슬·봇 보상이 고르는 후보(🔥활성 일반 키워드 번호). 구슬마다 전부 읽으면 키워드가 많을수록 무거워 5초 동안 모아 둔다.
     * 그 사이 활성이 아니게 된 키워드가 뽑히면 고른 쪽이 행을 잠근 뒤 상태를 확인하고(fresh=true로 다시 읽어) 다시 고른다.
     */
    private List<Long> activeIds(long countryId, boolean fresh) {
        long now = System.currentTimeMillis();
        ActiveIds c = activeIdCache.get(countryId);
        if (!fresh && c != null && now - c.at() < ACTIVE_IDS_TTL_MS) return c.ids();
        List<Long> ids = keywords.findIdsByCountryAndState(countryId, codes.keywordStateId(CodeTables.KW_ACTIVE));
        activeIdCache.put(countryId, new ActiveIds(ids, now));
        return ids;
    }

    /**
     * 구슬에서 잃기(4.20): 가진 키워드(🔥·💤 가리지 않고, 금지 제외)를 **구성 원본 단위**로 하나 무작위로 잃는다(합성 키워드면 원본 하나만 빠진다, 4.44).
     * 잃을 것이 없으면 꽝. 충돌 기록(잃은 횟수·통계)은 올리지 않는다
     */
    private KeywordDtos.OrbResult loseFromOrb(Player p) {
        Instant now = Instant.now(clock);
        Optional<Loss> lost = loseOneOriginal(p, now, false);
        if (lost.isEmpty()) return new KeywordDtos.OrbResult("MISS", null, null, null, 0, null, null);
        Loss l = lost.get();
        Keyword k = keywords.findById(l.keywordId()).orElseThrow();
        return new KeywordDtos.OrbResult("LOST", l.text(), l.state(), k.getTrendValue(), k.getHolderCount(), l.lostPoints(), null);
    }

    @Override
    @Transactional(readOnly = true)
    public List<BotKeyword> botCatalog(long countryId) {
        List<BotKeyword> out = new ArrayList<>();
        for (Object[] r : keywords.findCatalogRows(countryId, codes.keywordStateId(CodeTables.KW_ACTIVE))) {
            out.add(new BotKeyword(((Number) r[0]).longValue(), (String) r[1], ((Number) r[2]).longValue()));
        }
        return out;
    }

    @Override
    @Transactional
    public KeywordDtos.OrbResult gainFromBot(long playerId) { return gainFromBot(playerId, null); }

    @Override
    @Transactional
    public KeywordDtos.OrbResult gainFromBot(long playerId, long keywordId) { return gainFromBot(playerId, Long.valueOf(keywordId)); }

    private KeywordDtos.OrbResult gainFromBot(long playerId, Long botKeywordId) {
        Player p = players.findByIdForUpdate(playerId).orElse(null);
        if (p == null) return new KeywordDtos.OrbResult("NONE", null, null, null, 0, null, null);
        p.incBotWin(); // 칭호(4.10)
        playerService.awardAttack(p); // 봇도 빼앗기 대상이다: 공격에 성공했으니 빼앗은 횟수 +1과 공격 성공 EXP(4.3)
        events.publishEvent(new GameEvents.TitleCheck(p.getId()));
        Instant now = Instant.now(clock);
        // 구슬과 달리 꽝이 없다. 🔥 키워드 전체에서 고른다
        List<Long> ids = activeIds(p.getCountry().getId(), false);
        if (botKeywordId != null && !ids.contains(botKeywordId)) ids = activeIds(p.getCountry().getId(), true); // 지정한 키워드가 목록에 없으면(몇 초 안에 생긴 것) 새로 읽는다
        if (ids.isEmpty()) return new KeywordDtos.OrbResult("NONE", null, null, null, 0, null, null);
        // 봇이 잃은 그 키워드를 준다. 그 사이 🔥가 아니게 됐으면(비활성·금지) 무작위 🔥 키워드로 대신한다
        Long pick = botKeywordId != null && ids.contains(botKeywordId) ? botKeywordId : ids.get(ThreadLocalRandom.current().nextInt(ids.size()));
        Keyword k = keywords.findByIdForUpdate(pick).orElseThrow();
        Optional<PlayerKeyword> existing = holdings.findByPlayerIdAndKeywordId(p.getId(), k.getId()); // 만료됐지만 아직 안 지운 행일 수도 있다
        Optional<PlayerKeyword> holding = covering(p.getId(), k.getId(), now); // 합성 키워드로 가진 것도 이미 가진 것(4.44)
        if (holding.isPresent()) {
            // 이미 가진 키워드: 사람에게서 빼앗을 때와 같이 남은 시간만 지금부터 다시 24시간(4.3)
            return new KeywordDtos.OrbResult("RENEWED", k.getText(), k.getKeywordState().getName(), k.getTrendValue(),
                    k.getHolderCount(), 0L, renewHolding(holding.get(), now), k.getId());
        }
        Added r = addHoldingCore(p, k, existing, now);
        return new KeywordDtos.OrbResult("GAINED", k.getText(), k.getKeywordState().getName(), k.getTrendValue(),
                k.getHolderCount(), r.gained(), r.expires(), k.getId());
    }

    // ---------------------------------------------------------------- 목록형 외부 소스(10.2)

    @Override
    public int applyExternalTitles(String countryCode, String sourceName, List<String> titles) {
        int held = 0;
        for (String title : titles) {
            String text = KeywordNormalizer.fromExternal(title);
            String normalized;
            try {
                normalized = KeywordNormalizer.validate(text); // 4.6 등록 조건을 통과하지 못하면 버린다
            } catch (ApiException e) {
                log.debug("skip external title '{}': {}", title, e.code());
                continue;
            }
            try {
                Boolean r = tx.execute(st -> holdFromList(countryCode, sourceName, text, normalized));
                if (Boolean.TRUE.equals(r)) held++;
            } catch (RuntimeException e) {
                log.warn("external title '{}' failed", title, e);
            }
        }
        return held;
    }

    /** 목록에 오른 단어 하나: 없으면 🔥로 만들고, 있으면 그 소스로 지금부터 유지 기간(기본 7일)을 다시 센다. 새로 유지를 시작했으면 true. */
    private boolean holdFromList(String countryCode, String sourceName, String text, String normalized) {
        Instant now = Instant.now(clock);
        DataSource source = codes.dataSource(sourceName);
        if (source.getWeight().signum() == 0) return false; // 가중치 0이면 쓰지 않는다
        if (bannedWords.contains(countryCode, normalized)) return false; // 금지어가 들어 있는 외부 제목은 버린다
        Optional<Keyword> found = keywords.findByCountryIdAndNormalized(countryOf(countryCode).getId(), normalized);
        if (found.isEmpty()) {
            createKeyword(countryOf(countryCode), text, normalized, Optional.of(new Confirmed(source, 100)), now);
            return true;
        }
        Keyword k = keywords.findByIdForUpdate(found.get().getId()).orElseThrow();
        if (isBanned(k)) return false;
        boolean holding = k.getDataSource().getId().equals(source.getId()) && k.getExternalUntil() != null
                && k.getExternalUntil().isAfter(now);
        k.holdExternal(source, externalHoldUntil(now)); // 목록에 보일 때마다 지금부터 다시 7일
        if (holding) return false;
        long old = k.getTrendValue();
        k.activate(codes.keywordState(CodeTables.KW_ACTIVE), now);
        activeIdCache.remove(k.getCountry().getId()); // 구슬 후보 목록에 바로 반영
        long nw = updateTrend(k);
        publishTrendChange(k, old, nw, null);
        return true;
    }

    // ---------------------------------------------------------------- 관리자 키워드(13.7)

    @Override
    @Transactional
    public AdminKeyword adminAdd(String countryCode, String text) {
        String display = KeywordNormalizer.display(text);
        String normalized = KeywordNormalizer.validate(display);
        Country country = countryOf(countryCode);
        DataSource source = codes.dataSource(DataSource.ADMIN);
        if (source.getWeight().signum() == 0) throw ApiException.badRequest("SOURCE_DISABLED", "admin 소스의 가중치가 0이라 쓸 수 없어요");
        Instant now = Instant.now(clock);
        Optional<Keyword> found = keywords.findByCountryIdAndNormalized(country.getId(), normalized);
        if (found.map(k -> !isBanned(k)).orElse(true) && bannedWords.contains(country.getCode(), normalized))
            throw ApiException.conflict("KEYWORD_BANNED", "금지된 키워드가 들어 있어요. 금지를 먼저 풀어 주세요");
        if (found.isEmpty()) {
            // 새 키워드: 🔥활성, 반영 소스 admin, 지금부터 유지 기간(createKeyword가 유지 기간형 소스로 처리)
            Keyword k = createKeyword(country, display, normalized, Optional.of(new Confirmed(source, 100)), now);
            return adminView(k, true);
        }
        Keyword k = keywords.findByIdForUpdate(found.get().getId()).orElseThrow();
        if (isBanned(k)) throw ApiException.conflict("KEYWORD_BANNED", "금지된 키워드예요. 금지를 먼저 풀어 주세요");
        long old = k.getTrendValue();
        k.holdExternal(source, externalHoldUntil(now)); // 다른 소스였어도 admin으로 바꾸고 지금부터 다시 7일
        k.activate(codes.keywordState(CodeTables.KW_ACTIVE), now);
        activeIdCache.remove(k.getCountry().getId()); // 구슬 후보 목록에 바로 반영
        long nw = updateTrend(k);
        keywords.flush();
        publishTrendChange(k, old, nw, null);
        return adminView(k, false);
    }

    private static final Set<String> ADMIN_SORTS = Set.of("trendValue", "holderCount", "addCount", "searchCount", "viewCount",
            "createdAt", "activatedAt", "externalUntil");

    @Override
    @Transactional(readOnly = true)
    public AdminKeywordLookup adminLookup(String countryCode, String text) {
        Country country = countryOf(countryCode);
        String display = KeywordNormalizer.display(text);
        String normalized;
        try {
            normalized = KeywordNormalizer.validate(display);
        } catch (ApiException e) {
            return new AdminKeywordLookup(display, "", false, e.getMessage(), null);
        }
        AdminKeywordRow row = keywords.findByCountryIdAndNormalized(country.getId(), normalized).map(this::adminRow).orElse(null);
        return new AdminKeywordLookup(display, normalized, true, null, row);
    }

    @Override
    @Transactional
    public AdminKeywordRow adminBanText(String countryCode, String text) {
        String display = KeywordNormalizer.display(text);
        String normalized = KeywordNormalizer.validate(display);
        Country country = countryOf(countryCode);
        Instant now = Instant.now(clock);
        // 등록 전이면 💤비활성으로 만든 뒤 같은 트랜잭션에서 금지한다(공개 페이지·사이트맵 캐시도 adminBan이 비운다)
        Keyword k = keywords.findByCountryIdAndNormalized(country.getId(), normalized)
                .orElseGet(() -> createKeyword(country, display, normalized, Optional.empty(), now));
        return adminBan(k.getId(), true);
    }

    @Override
    @Transactional(readOnly = true)
    public AdminKeywordPage adminSearch(String countryCode, String state, String source, String q, String sort, String dir,
                                        int page, int size) {
        Country country = countryOf(countryCode);
        // 상태·소스는 쉼표로 여러 개를 받는다(비면 전체). 예: "활성,금지"
        List<Long> stateIds = csv(state).stream().map(codes::keywordStateId).toList();
        List<Long> sourceIds = csv(source).stream().map(n -> codes.dataSource(n).getId()).toList();
        String like = q == null || q.isBlank() ? null : "%" + KeywordNormalizer.normalize(q) + "%";
        String by = ADMIN_SORTS.contains(sort) ? sort : "createdAt";
        Sort.Direction d = "asc".equalsIgnoreCase(dir) ? Sort.Direction.ASC : Sort.Direction.DESC;
        int sz = Math.max(1, Math.min(size, 100));
        Sort order = Sort.by(d, by).and(Sort.by(Sort.Direction.DESC, "id"));
        var result = keywords.searchForAdmin(country.getId(), stateIds.isEmpty(), stateIds.isEmpty() ? List.of(-1L) : stateIds,
                sourceIds.isEmpty(), sourceIds.isEmpty() ? List.of(-1L) : sourceIds, like, PageRequest.of(Math.max(0, page), sz, order));
        Map<String, Long> counts = new LinkedHashMap<>();
        for (Object[] row : keywords.countByStateForAdmin(country.getId(), sourceIds.isEmpty(), sourceIds.isEmpty() ? List.of(-1L) : sourceIds, like)) counts.put((String) row[0], (Long) row[1]);
        return new AdminKeywordPage(result.getContent().stream().map(this::adminRow).toList(), result.getTotalElements(),
                result.getNumber(), sz, counts);
    }

    /** 쉼표로 이은 값을 나눈다. 비었으면 빈 목록 */
    private static List<String> csv(String v) {
        if (v == null || v.isBlank()) return List.of();
        return java.util.Arrays.stream(v.split(",")).map(String::trim).filter(x -> !x.isEmpty()).distinct().toList();
    }

    @Override
    @Transactional
    public AdminKeywordRow adminBan(long keywordId, boolean banned) {
        Keyword k = keywords.findByIdForUpdate(keywordId)
                .orElseThrow(() -> ApiException.notFound("KEYWORD_NOT_FOUND", "키워드를 찾을 수 없어요"));
        Instant now = Instant.now(clock);
        if (banned == isBanned(k)) return adminRow(k);
        long old = k.getTrendValue();
        if (banned) k.ban(codes.keywordState(CodeTables.KW_BANNED), now);
        else k.unban(codes.keywordState(CodeTables.KW_INACTIVE), now);
        long nw = updateTrend(k); // 금지·💤면 0
        keywords.flush();
        events.publishEvent(new com.trendist.keyword.support.KeywordPageEvents.Changed(k.getCountry().getCode(), k.getNormalized())); // 공개 페이지·사이트맵 캐시를 커밋 뒤 비운다(4.28)
        if (banned) events.publishEvent(new com.trendist.keyword.support.KeywordPageEvents.Banned(k.getCountry().getCode(), k.getNormalized())); // 커밋 뒤 모든 플레이어의 보관함에서 지운다
        publishTrendChange(k, old, nw, null); // 접속 중인 보유자는 바로, 아닌 보유자는 1분 재합산에서 점수가 빠진다
        return adminRow(k);
    }

    private AdminKeywordRow adminRow(Keyword k) {
        return new AdminKeywordRow(k.getId(), k.getText(), k.getNormalized(), k.getKeywordState().getName(), k.getDataSource().getName(),
                k.getTrendValue(), k.getHolderCount(), k.getAddCount(), k.getSearchCount() + searchCounter.pending(k.getId()),
                k.getViewCount() + viewCounter.pendingOf(k.getId()), k.getExternalUntil(), k.getActivatedAt(), k.getBannedAt(), k.getCreatedAt());
    }

    private AdminKeyword adminView(Keyword k, boolean created) {
        return new AdminKeyword(k.getId(), k.getText(), k.getKeywordState().getName(), k.getTrendValue(), k.getHolderCount(),
                k.getExternalUntil(), created);
    }

    @Override
    public int expireExternal(String sourceName, Set<String> currentNormalized) {
        DataSource source = codes.dataSource(sourceName);
        return expireStale(source, keywords.findByDataSourceIdAndExternalUntilBefore(source.getId(), Instant.now(clock)), currentNormalized);
    }

    @Override
    public int expireExternal(String countryCode, String sourceName, Set<String> currentNormalized) {
        DataSource source = codes.dataSource(sourceName);
        return expireStale(source, keywords.findByDataSourceIdAndCountryCodeAndExternalUntilBefore(source.getId(), countryCode, Instant.now(clock)),
                currentNormalized);
    }

    private int expireStale(DataSource source, List<Keyword> stales, Set<String> currentNormalized) {
        int dropped = 0;
        for (Keyword stale : stales) {
            try {
                Boolean r = tx.execute(st -> expireOneExternal(stale.getId(), source, currentNormalized));
                if (Boolean.TRUE.equals(r)) dropped++;
            } catch (RuntimeException e) {
                log.warn("expire external keyword {} failed", stale.getId(), e);
            }
        }
        return dropped;
    }

    private boolean expireOneExternal(long keywordId, DataSource source, Set<String> currentNormalized) {
        Instant now = Instant.now(clock);
        Keyword k = keywords.findByIdForUpdate(keywordId).orElse(null);
        if (k == null || !k.getDataSource().getId().equals(source.getId())
                || k.getExternalUntil() == null || k.getExternalUntil().isAfter(now)) return false;
        if (currentNormalized.contains(k.getNormalized())) {
            k.holdExternal(source, externalHoldUntil(now)); // 유지 기간이 끝나도 아직 목록에 있으면 지금부터 다시
            return false;
        }
        long old = k.getTrendValue();
        k.dropExternal(codes.dataSource(DataSource.INTERNAL));
        // 내부 데이터만으로는 가진 사람이 3명 이상이어야 🔥(4.7)
        if (isState(k, CodeTables.KW_ACTIVE) && k.getHolderCount() < settings.getInt(SettingKeys.ACTIVATE_HOLDERS)) {
            k.deactivate(codes.keywordState(CodeTables.KW_INACTIVE), now);
            events.publishEvent(new com.trendist.keyword.support.KeywordPageEvents.Deactivated(k.getId())); // 합성 키워드에서 빼낸다(4.44)
        }
        long nw = updateTrend(k);
        publishTrendChange(k, old, nw, null);
        return true;
    }

    // ---------------------------------------------------------------- 조회

    @Override
    @Transactional(readOnly = true)
    public List<KeywordDtos.MyKeyword> myKeywords(long userId) {
        return myKeywordsOfPlayer(playerService.requireCurrent(userId).getId());
    }

    @Override
    @Transactional(readOnly = true)
    public List<KeywordDtos.MyKeyword> myKeywordsOfPlayer(long playerId) {
        Instant now = Instant.now(clock);
        List<PlayerKeyword> rows = holdings.findActiveByPlayer(playerId, now, codes.keywordStateId(CodeTables.KW_BANNED));
        Map<Long, List<KeywordDtos.MergedPart>> partsOf = mergedPartsOf(rows.stream().map(pk -> pk.getKeyword()).filter(Keyword::isMerged).map(Keyword::getId).toList());
        return rows.stream().map(pk -> myKeyword(pk, partsOf)).toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<Long> activeKeywordIds(long playerId) {
        return holdings.findActiveByPlayer(playerId, Instant.now(clock), codes.keywordStateId(CodeTables.KW_BANNED))
                .stream().map(pk -> pk.getKeyword().getId()).toList();
    }

    // ---------------------------------------------------------------- 만료, 잃기, 재합산

    /** 만료된 + 하나를 지우고 인원·트렌드 값·점수를 고친다. 지웠으면 true. */
    @Override
    @Transactional
    public boolean expireOne(long playerKeywordId) {
        Instant now = Instant.now(clock);
        PlayerKeyword pk = holdings.findById(playerKeywordId).orElse(null);
        if (pk == null) return false;
        Player p = players.findByIdForUpdate(pk.getPlayer().getId()).orElseThrow();
        Long keywordId = pk.getKeyword().getId();
        if (holdings.deleteIfExpired(playerKeywordId, now) == 0) return false; // 방금 재사용된 행
        removeHolding(p, keywordId, now);
        return true;
    }

    /**
     * 충돌로 잃기(4.3): 금지되지 않은 키워드를 **구성 원본 단위**로 하나 무작위로 잃는다. 합성 키워드(4.44)에서는 원본 하나만 빠지고 성이 낮아진다.
     * 잃은 원본의 이름과, 내 유행도가 실제로 줄어든 점수를 돌려준다.
     */
    @Override
    @Transactional
    public Optional<LostKeyword> loseRandom(long playerId) {
        Player p = players.findByIdForUpdate(playerId).orElse(null);
        if (p == null || p.getHoldCount() == 0) return Optional.empty();
        return loseOneOriginal(p, Instant.now(clock), true).map(l -> new LostKeyword(l.keywordId(), l.text(), l.lostPoints()));
    }

    /** 모두 잃기(4.25): 개수는 구성 원본 단위로 센다(일반 키워드 1개는 1, N성 합성 키워드는 N개, 4.44). */
    @Override
    @Transactional
    public Optional<LostAll> loseAll(long playerId) {
        Player p = players.findByIdForUpdate(playerId).orElse(null);
        if (p == null || p.getHoldCount() == 0) return Optional.empty();
        Instant now = Instant.now(clock);
        List<PlayerKeyword> candidates = holdings.findLosableByPlayer(playerId, now, codes.keywordStateId(CodeTables.KW_BANNED));
        if (candidates.isEmpty()) return Optional.empty();
        long score = 0;
        int count = 0, activeCount = 0;
        List<Long> keywordIds = new ArrayList<>();
        for (PlayerKeyword pk : candidates) {
            Keyword k = pk.getKeyword();
            if (k.isMerged()) {
                score += k.getTrendValue(); // 합성 점수
                for (Keyword part : keywords.findAllById(partIdsOf(k.getId()))) {
                    count++;
                    if (isState(part, CodeTables.KW_ACTIVE)) activeCount++;
                }
            } else {
                count++;
                if (isState(k, CodeTables.KW_ACTIVE)) { score += k.getTrendValue(); activeCount++; } // 💤는 점수에 더해 주지 않았다
            }
            keywordIds.add(k.getId());
        }
        holdings.deleteAll(candidates);
        holdings.flush();
        p.incLose(); // 칭호(4.10): 한 번 부딪혀 잃은 것이므로 한 번으로 센다
        activity.add(p.getCountry().getId(), com.trendist.stats.support.ActivityCounter.Kind.COLLISION); // 사이트 통계(13.9)
        // 인원·트렌드 값·점수를 고친다: 일반 키워드는 한꺼번에(점수는 한 번만 다시 계산), 합성 키워드는 구성 원본마다 따로
        List<Long> plain = candidates.stream().map(PlayerKeyword::getKeyword).filter(k -> !k.isMerged()).map(Keyword::getId).toList();
        removePlainHoldings(p, plain, now);
        for (Long keywordId : keywordIds) if (!plain.contains(keywordId)) removeHolding(p, keywordId, now);
        return Optional.of(new LostAll(count, activeCount, score));
    }

    /**
     * 일부 잃기(죽음·불꽃에 부딪힘, 4.25·4.36): 가진 키워드를 **구성 원본 단위**로 세어(일반 1개 = 1, N성 합성 = N개, 4.44) max(1, 원본 수 × percent%의 내림)개를
     * 무작위로 잃는다. 합성 키워드에서는 뽑힌 원본만 빠지고 성이 낮아지며(남은 시간 유지), 원본이 모두 뽑히면 합성 키워드가 사라진다.
     */
    @Override
    @Transactional
    public Optional<LostAll> loseFraction(long playerId, int percent) {
        if (percent >= 100) return loseAll(playerId);
        Player p = players.findByIdForUpdate(playerId).orElse(null);
        if (p == null || p.getHoldCount() == 0 || percent <= 0) return Optional.empty();
        Instant now = Instant.now(clock);
        List<PlayerKeyword> candidates = holdings.findLosableByPlayer(playerId, now, codes.keywordStateId(CodeTables.KW_BANNED));
        if (candidates.isEmpty()) return Optional.empty();
        List<Long> originals = new ArrayList<>();
        for (PlayerKeyword pk : candidates) {
            if (pk.getKeyword().isMerged()) originals.addAll(partIdsOf(pk.getKeyword().getId()));
            else originals.add(pk.getKeyword().getId());
        }
        int count = Math.max(1, originals.size() * percent / 100); // 내림, 최소 1개(정수 계산이라 소수점이 생기지 않는다)
        java.util.Collections.shuffle(originals, ThreadLocalRandom.current());
        List<Long> lost = originals.subList(0, Math.min(count, originals.size()));
        p.incLose(); // 칭호(4.10): 한 번 부딪혀 잃은 것이므로 한 번으로 센다
        activity.add(p.getCountry().getId(), com.trendist.stats.support.ActivityCounter.Kind.COLLISION);
        long score = 0;
        int activeCount = 0;
        // 일반 키워드로 직접 가진 것은 한꺼번에 잃고(키워드를 한 번에 잠그고 점수는 한 번만 다시 계산), 합성 키워드 안의 원본은 하나씩 뺀다
        Map<Long, PlayerKeyword> plainRow = new HashMap<>();
        for (PlayerKeyword pk : candidates) if (!pk.getKeyword().isMerged()) plainRow.put(pk.getKeyword().getId(), pk);
        List<Long> plainLost = new ArrayList<>();
        List<PlayerKeyword> plainRows = new ArrayList<>();
        for (Long id : lost) {
            PlayerKeyword row = plainRow.get(id);
            if (row == null) continue;
            plainLost.add(id);
            plainRows.add(row);
            Keyword k = row.getKeyword();
            if (isState(k, CodeTables.KW_ACTIVE)) { activeCount++; score += k.getTrendValue(); } // 💤는 점수에 더해 주지 않았다
        }
        holdings.deleteAll(plainRows);
        holdings.flush();
        removePlainHoldings(p, plainLost, now);
        for (Long id : lost) {
            if (plainRow.containsKey(id)) continue;
            Keyword original = keywords.findById(id).orElse(null);
            if (original == null) continue;
            if (isState(original, CodeTables.KW_ACTIVE)) activeCount++;
            score += loseOriginal(p, id, now);
        }
        return Optional.of(new LostAll(lost.size(), activeCount, score));
    }

    /** 구성 원본 하나를 잃는다: 일반 키워드면 그 행을 지우고, 합성 키워드 안에 있으면 그 원본만 뺀다. 내 유행도가 실제로 줄어든 점수를 돌려준다. */
    private long loseOriginal(Player p, Long keywordId, Instant now) {
        Optional<PlayerKeyword> row = covering(p.getId(), keywordId, now);
        if (row.isEmpty()) return 0;
        PlayerKeyword pk = row.get();
        Keyword k = pk.getKeyword();
        if (k.isMerged()) return dropPartFromHolding(p, pk, keywordId, now);
        long points = isState(k, CodeTables.KW_ACTIVE) ? k.getTrendValue() : 0;
        holdings.delete(pk);
        holdings.flush();
        removeHolding(p, keywordId, now);
        return points;
    }

    @Override
    @Transactional
    public Optional<StolenKeyword> stealRandom(long loserId, long winnerId) {
        // 두 플레이어 행을 번호 순서로 잠근다(두 사람이 동시에 서로에게서 빼앗아도 교착하지 않게). 그다음 키워드(플레이어 → 키워드 순서)
        Player first = players.findByIdForUpdate(Math.min(loserId, winnerId)).orElse(null);
        Player second = players.findByIdForUpdate(Math.max(loserId, winnerId)).orElse(null);
        if (first == null || second == null || loserId == winnerId) return Optional.empty();
        Player loser = first.getId() == loserId ? first : second, winner = loser == first ? second : first;
        if (loser.getHoldCount() == 0 || !loser.getCountry().getId().equals(winner.getCountry().getId())) return Optional.empty();
        Instant now = Instant.now(clock);
        // 구성 원본 단위로 하나를 잃는다(합성 키워드면 원본 하나만 빠지고 성이 낮아진다, 4.44). 이긴 쪽은 그 원본을 일반 키워드로 빼앗는다
        Optional<Loss> lost = loseOneOriginal(loser, now, true);
        if (lost.isEmpty()) return Optional.empty();
        Loss l = lost.get();
        playerService.awardAttack(winner); // 빼앗은 횟수 +1과 공격 성공 EXP(4.3). 점수·레벨을 다시 정하고 칭호를 확인한다

        Keyword k = keywords.findByIdForUpdate(l.keywordId()).orElseThrow();
        Optional<PlayerKeyword> holding = covering(winnerId, l.keywordId(), now); // 합성 키워드로 가진 것도 이미 가진 것(4.44)
        if (holding.isPresent()) {
            // 이미 가진 키워드: 남은 시간만 지금부터 다시 24시간. 점수·EXP는 그대로
            return Optional.of(new StolenKeyword(l.text(), l.score(), "RENEWED", 0, renewHolding(holding.get(), now)));
        }
        // 없던 키워드: 일반 추가와 같이 보관함에 넣는다(24시간, EXP +1, 가진 사람 수 +1, 점수 반영). 구슬(4.20)과 같은 방식
        Optional<PlayerKeyword> existing = holdings.findByPlayerIdAndKeywordId(winnerId, l.keywordId());
        KeywordDtos.PlusResult r = addHolding(winner, k, existing, now);
        return Optional.of(new StolenKeyword(l.text(), l.score(), "ADDED", r.gained(), r.keyword().myExpiresAt()));
    }

    /**
     * 금지가 커밋되면 모든 플레이어의 보관함에서 그 키워드와 금지어가 들어 있는 키워드를 바로 지운다(4.7).
     * 금지 트랜잭션이 끝난 뒤에, 보관함 행마다 따로 새 트랜잭션으로 한다(플레이어 → 키워드 잠금 순서를 지키고, 한 건이 실패해도 나머지는 계속한다).
     * 접속 중인 사람의 보관함·점수는 `HoldingChanged`로 바로 고쳐진다.
     */
    @org.springframework.transaction.event.TransactionalEventListener
    public void onBanned(com.trendist.keyword.support.KeywordPageEvents.Banned e) { purgeBanned(e.countryCode(), e.normalized()); }

    int purgeBanned(String countryCode, String normalized) {
        TransactionTemplate fresh = new TransactionTemplate(tx.getTransactionManager());
        fresh.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        List<Long> ids = fresh.execute(st -> holdings.findIdsHoldingBanned(countryCode, normalized, normalized.length() >= BannedWordFilter.MIN_WORD_LENGTH));
        int removed = 0;
        for (Long id : ids == null ? List.<Long>of() : ids) {
            try {
                Boolean r = fresh.execute(st -> {
                    PlayerKeyword pk = holdings.findById(id).orElse(null);
                    if (pk == null) return false;
                    Player p = players.findByIdForUpdate(pk.getPlayer().getId()).orElseThrow(); // 잠금 순서: 플레이어 → 키워드
                    Long keywordId = pk.getKeyword().getId();
                    holdings.delete(pk);
                    holdings.flush();
                    removeHolding(p, keywordId, Instant.now(clock));
                    return true;
                });
                if (Boolean.TRUE.equals(r)) removed++;
            } catch (RuntimeException ex) {
                log.warn("purge banned holding {} failed", id, ex);
            }
        }
        return removed + purgeBannedMerged(fresh, countryCode, normalized);
    }

    /**
     * 합성 키워드(4.44)의 금지 정리: ① 구성 원본이 금지된 것이면(금지어가 들어 있는 원본 포함) 그 원본만 빠지고 성이 낮아진다(남은 시간 유지).
     * ② 이어 붙인 글자가 금지어를 품은 합성 키워드는 보관함에서 통째로 지운다.
     */
    private int purgeBannedMerged(TransactionTemplate fresh, String countryCode, String normalized) {
        boolean contain = normalized.length() >= BannedWordFilter.MIN_WORD_LENGTH;
        int removed = 0;
        for (int round = 0; round < 20; round++) { // 한 행에 금지된 원본이 여럿이면 한 번에 하나씩 빠지므로 없을 때까지 되풀이한다
            List<Object[]> rows = fresh.execute(st -> holdings.findMergedRowsWithBannedPart(countryCode, normalized, contain));
            int done = 0;
            for (Object[] r : rows == null ? List.<Object[]>of() : rows) {
                long rowId = ((Number) r[0]).longValue(), partId = ((Number) r[1]).longValue();
                try {
                    Boolean ok = fresh.execute(st -> {
                        PlayerKeyword pk = holdings.findById(rowId).orElse(null);
                        if (pk == null || !pk.getKeyword().isMerged()) return false;
                        Player p = players.findByIdForUpdate(pk.getPlayer().getId()).orElseThrow();
                        return dropPartFromHolding(p, pk, partId, Instant.now(clock)) >= 0;
                    });
                    if (Boolean.TRUE.equals(ok)) done++;
                } catch (RuntimeException ex) {
                    log.warn("purge banned merged part {} failed", rowId, ex);
                }
            }
            removed += done;
            if (done == 0) break;
        }
        List<Long> ids = fresh.execute(st -> holdings.findMergedRowIdsByCountry(countryCode));
        for (Long id : ids == null ? List.<Long>of() : ids) {
            try {
                Boolean ok = fresh.execute(st -> {
                    PlayerKeyword pk = holdings.findById(id).orElse(null);
                    if (pk == null) return false;
                    String joined = KeywordNormalizer.normalize(pk.getKeyword().getText());
                    if (contain ? !joined.contains(normalized) : !joined.equals(normalized)) return false;
                    Player p = players.findByIdForUpdate(pk.getPlayer().getId()).orElseThrow();
                    Long keywordId = pk.getKeyword().getId();
                    holdings.delete(pk);
                    holdings.flush();
                    removeHolding(p, keywordId, Instant.now(clock));
                    return true;
                });
                if (Boolean.TRUE.equals(ok)) removed++;
            } catch (RuntimeException ex) {
                log.warn("purge banned merged text {} failed", id, ex);
            }
        }
        return removed;
    }

    /**
     * 일반 키워드가 💤비활성이 되면(4.44) 그 원본이 든 모든 합성 키워드에서 그 원본을 뺀다(성이 낮아지고 남은 시간은 유지).
     * 비활성이 되는 키워드는 가진 사람(합성 보유자 포함)이 활성 전환 인원(기본 3명) 미만이라 대상은 몇 행뿐이다.
     * 전환이 일어난 트랜잭션에서는 원본 키워드를 잠근 채라 다른 플레이어를 잠그면 잠금 순서(플레이어 → 키워드)가 거꾸로 되므로,
     * 커밋 뒤에 행마다 새 트랜잭션으로 한다. 다시 🔥가 돼도 빠진 원본은 돌아오지 않는다.
     */
    @org.springframework.transaction.event.TransactionalEventListener
    public void onDeactivated(com.trendist.keyword.support.KeywordPageEvents.Deactivated e) { splitInactivePart(e.keywordId()); }

    int splitInactivePart(long partId) {
        TransactionTemplate fresh = new TransactionTemplate(tx.getTransactionManager());
        fresh.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        List<Long> ids = fresh.execute(st -> holdings.findMergedRowIdsWithPart(partId, Instant.now(clock)));
        int split = 0;
        for (Long id : ids == null ? List.<Long>of() : ids) {
            try {
                Boolean ok = fresh.execute(st -> {
                    PlayerKeyword pk = holdings.findById(id).orElse(null);
                    Keyword part = keywords.findById(partId).orElse(null);
                    if (pk == null || part == null || !pk.getKeyword().isMerged() || isState(part, CodeTables.KW_ACTIVE)) return false; // 그 사이 🔥로 돌아왔으면 그대로 둔다
                    Player p = players.findByIdForUpdate(pk.getPlayer().getId()).orElseThrow(); // 잠금 순서: 플레이어 → 키워드
                    return dropPartFromHolding(p, pk, partId, Instant.now(clock)) >= 0;
                });
                if (Boolean.TRUE.equals(ok)) split++;
            } catch (RuntimeException ex) {
                log.warn("split inactive part {} from holding {} failed", partId, id, ex);
            }
        }
        return split;
    }

    /**
     * 일반(합성이 아닌) 키워드 여러 개를 이 플레이어가 잃었다(보관함 행은 이미 지운 뒤에 부른다): 키워드를 번호 순으로 한 번에 잠그고 가진 사람 수·보유 수·점수를 고친 뒤
     * 플레이어 점수는 한 번만 다시 계산한다. 키워드마다 따로 하면 불꽃·사망으로 수백 개를 잃을 때 키워드 수만큼 조회·쓰기·점수 계산이 반복된다.
     */
    private void removePlainHoldings(Player p, Collection<Long> keywordIds, Instant now) {
        if (keywordIds.isEmpty()) return;
        for (Keyword k : keywords.findAllByIdForUpdate(new TreeSet<>(keywordIds))) {
            long oldTrend = k.getTrendValue();
            k.decHolder();
            p.decHold();
            // 외부 데이터가 없고 가진 사람이 3명 미만이면 💤(4.7)
            if (isState(k, CodeTables.KW_ACTIVE) && k.getDataSource().isInternal() && k.getHolderCount() < settings.getInt(SettingKeys.ACTIVATE_HOLDERS)) {
                k.deactivate(codes.keywordState(CodeTables.KW_INACTIVE), now);
                events.publishEvent(new com.trendist.keyword.support.KeywordPageEvents.Deactivated(k.getId())); // 합성 키워드에서 빼낸다(4.44)
            }
            long newTrend = updateTrend(k);
            publishTrendChange(k, oldTrend, newTrend, p.getId());
            events.publishEvent(new GameEvents.HoldingChanged(p.getCountry().getId(), p.getId(), k.getId(), false));
        }
        keywords.flush();
        playerService.recompute(p);
    }

    private void removeHolding(Player p, Long keywordId, Instant now) { removeHolding(p, keywordId, now, null, true); }

    private void removeHolding(Player p, Long keywordId, Instant now, MergeBatch batch, boolean recompute) {
        if (keywords.findById(keywordId).map(Keyword::isMerged).orElse(false)) { removeMergedHolding(p, keywordId, batch, recompute); return; } // 합성 키워드(4.44)
        Keyword k = lockKw(batch, keywordId);
        long oldTrend = k.getTrendValue();
        k.decHolder();
        p.decHold();
        // 외부 데이터가 없고 가진 사람이 3명 미만이면 💤(4.7)
        if (isState(k, CodeTables.KW_ACTIVE) && k.getDataSource().isInternal()
                && k.getHolderCount() < settings.getInt(SettingKeys.ACTIVATE_HOLDERS)) {
            k.deactivate(codes.keywordState(CodeTables.KW_INACTIVE), now);
            events.publishEvent(new com.trendist.keyword.support.KeywordPageEvents.Deactivated(k.getId())); // 합성 키워드에서 빼낸다(4.44)
        }
        long newTrend = updateTrend(k);
        if (batch == null) keywords.flush();
        if (recompute) playerService.recompute(p);
        publishTrendChange(k, oldTrend, newTrend, p.getId());
        events.publishEvent(new GameEvents.HoldingChanged(p.getCountry().getId(), p.getId(), keywordId, false));
    }

    @Override
    public int refreshTrendValues() {
        population.refresh();
        Long activeId = codes.keywordStateId(CodeTables.KW_ACTIVE);
        int changed = 0;
        List<Keyword> all = keywords.findAllByStateWithSource(activeId);
        // 일반 키워드를 먼저, 합성 키워드(4.44)는 구성 원본의 값을 따라가므로 그다음에 다시 구한다
        Map<Long, List<Long>> mergedParts = Map.of();
        Map<Long, Keyword> partById = Map.of();
        for (int pass = 0; pass < 2; pass++) {
            if (pass == 1) { // 합성 키워드의 구성 원본은 한 번에 읽는다(합성 키워드마다 조회하면 합성이 많을수록 SQL이 폭증한다). 일반 키워드를 고친 뒤라 최신 값이다
                List<Long> mergedIds = all.stream().filter(Keyword::isMerged).map(Keyword::getId).toList();
                if (!mergedIds.isEmpty()) {
                    mergedParts = new HashMap<>();
                    for (KeywordMergePart mp : mergeParts.findByKeywordIds(mergedIds)) mergedParts.computeIfAbsent(mp.getKeywordId(), x -> new ArrayList<>()).add(mp.getPartKeywordId());
                    Map<Long, Keyword> byId = new HashMap<>();
                    keywords.findAllById(mergedParts.values().stream().flatMap(List::stream).distinct().toList()).forEach(pk -> byId.put(pk.getId(), pk));
                    partById = byId;
                }
            }
            for (Keyword k : all) {
                if (k.isMerged() != (pass == 1)) continue;
                long v = k.isMerged() ? mergedFromBatch(k, mergedParts, partById)
                        : formula.trendValue(true, k.getHolderCount(), k.getDataSource().getWeight().doubleValue(),
                                population.get(k.getCountry().getId()), normalizedLength(k));
                if (v == k.getTrendValue()) continue;
                try {
                    // 그 사이 +·삭제로 바뀌었을 수 있으니 행을 잠그고 다시 계산한다. 키워드 행만 잠그므로 플레이어 → 키워드 잠금 순서와 부딪히지 않는다
                    Boolean r = tx.execute(st -> keywords.findByIdForUpdate(k.getId()).map(locked -> {
                        long old = locked.getTrendValue();
                        long nw = updateTrend(locked);
                        publishTrendChange(locked, old, nw, null);
                        return old != nw;
                    }).orElse(false));
                    if (Boolean.TRUE.equals(r)) changed++;
                } catch (RuntimeException e) {
                    log.warn("trend refresh {} failed", k.getId(), e);
                }
            }
        }
        return changed;
    }

    /** 1분 잡: 트렌드 값이 바뀐 키워드의 보유자 점수를 DB 기준으로 다시 합산한다. */
    @Override
    public Set<Long> drainDirtyKeywords() {
        Set<Long> out = new HashSet<>(dirtyKeywords);
        dirtyKeywords.removeAll(out);
        return out;
    }

    @Override
    @Transactional(readOnly = true)
    public List<Long> holderPlayerIds(long keywordId) {
        return holdings.findHolderPlayerIds(keywordId, Instant.now(clock));
    }

    // ---------------------------------------------------------------- 합성(4.44)

    private static final int MAX_BONUS_TRIES = 30;

    /** 합성 한 번의 계획: 검증을 마친 재료 두 행과, 이어 붙인(정렬한) 구성 원본·이름. */
    /** decided면 실패·보너스를 이미 굴려 정한 계획이다(묶음 처리는 미리 모두 정해 두고 한꺼번에 읽고 쓴다) */
    private record MergePlan(PlayerKeyword rowA, PlayerKeyword rowB, List<Keyword> parts, String text, boolean decided, boolean failed, Keyword bonus) {
        MergePlan(PlayerKeyword rowA, PlayerKeyword rowB, List<Keyword> parts, String text) { this(rowA, rowB, parts, text, false, false, null); }
        MergePlan decide(boolean failed, Keyword bonus) { return new MergePlan(rowA, rowB, parts, text, true, failed, bonus); }
        /** 보너스까지 붙은 최종 구성 원본(번호 순) */
        List<Keyword> finalParts() { if (bonus == null) return parts; List<Keyword> l = new ArrayList<>(parts); l.add(bonus); return MergeKey.sorted(l); }
    }

    private PlayerKeyword heldRow(Player p, long keywordId, Instant now) {
        return holdings.findByPlayerIdAndKeywordId(p.getId(), keywordId).filter(pk -> !pk.isExpired(now))
                .orElseThrow(() -> ApiException.notFound("NOT_HELD", "보관함에 없는 키워드예요"));
    }

    private void assertMergeEnabled() {
        if (settings.getInt(SettingKeys.MERGE_ENABLED) == 0) throw ApiException.badRequest("MERGE_DISABLED", "지금은 합성할 수 없어요");
    }

    /**
     * 두 재료가 합쳐지는지 보는 규칙(조회 없음): 금지·비활성·구성 겹침·글자 수·금지 조합. 합칠 수 없으면 이유를 담은 ApiException,
     * 합칠 수 있으면 이어 붙일(정렬한) 구성 원본을 준다. 구성 원본은 합성 키워드면 그 구성, 아니면 자기 자신이다.
     * 합성 실행(planMerge)과 합성 불가 일괄 판정(mergeBlocked)이 같이 쓴다.
     */
    private List<Keyword> checkMergeable(Player p, Keyword a, List<Keyword> aParts, Keyword b, List<Keyword> bParts) {
        Map<Long, Keyword> parts = new LinkedHashMap<>();
        for (Keyword k : List.of(a, b)) {
            if (isBanned(k)) throw ApiException.badRequest("KEYWORD_BANNED", "합칠 수 없는 키워드예요");
            // 🔥활성 키워드끼리만 합칠 수 있다(합성 키워드는 항상 🔥)
            if (!k.isMerged() && !isState(k, CodeTables.KW_ACTIVE)) throw ApiException.badRequest("MERGE_NEEDS_ACTIVE", "활성 키워드만 합칠 수 있어요");
        }
        for (Keyword part : aParts) parts.put(part.getId(), part);
        for (Keyword part : bParts) {
            if (parts.putIfAbsent(part.getId(), part) != null) throw ApiException.badRequest("MERGE_OVERLAP", "이미 들어 있는 키워드가 겹쳐요");
        }
        List<Keyword> sorted = MergeKey.sorted(parts.values());
        int len = MergeKey.length(MergeKey.text(sorted));
        if (len > MergeKey.MAX_TEXT_LENGTH) {
            throw ApiException.badRequest("MERGE_TOO_LONG", (len - MergeKey.MAX_TEXT_LENGTH) + "자를 초과합니다 (최대 " + MergeKey.MAX_TEXT_LENGTH + "자)");
        }
        if (bannedWords.contains(p.getCountry().getCode(), MergeKey.joinedNormalized(sorted))) {
            throw ApiException.badRequest("KEYWORD_BANNED", "합칠 수 없는 조합이에요");
        }
        return sorted;
    }

    private List<Keyword> partsOf(Keyword k) {
        return k.isMerged() ? keywords.findAllById(partIdsOf(k.getId())) : List.of(k);
    }

    /** 합성 키워드의 구성 원본 엔티티(영속성 컨텍스트에 있으면 조회하지 않는다) */
    private List<Keyword> partKeywordsOf(Keyword merged) {
        List<Keyword> out = new ArrayList<>();
        for (Long id : partIdsOf(merged.getId())) keywords.findById(id).ifPresent(out::add);
        return out;
    }

    /** 묶음 처리에서 결과 카드를 만든다: 구성 원본을 메모리의 구성 기억과 영속성 컨텍스트에서 읽어 조회를 줄인다 */
    private KeywordDtos.MyKeyword myKeywordInBatch(PlayerKeyword pk) {
        Keyword k = pk.getKeyword();
        if (!k.isMerged()) return myKeyword(pk, Map.of());
        return myKeyword(pk, Map.of(k.getId(), partsDto(MergeKey.sorted(partKeywordsOf(k)))));
    }

    /** 합성할 수 있는지 검사하고 계획을 만든다. 합칠 수 없으면 이유를 담은 ApiException. */
    private MergePlan planMerge(Player p, long firstId, long secondId, Instant now) {
        assertMergeEnabled();
        if (firstId == secondId) throw ApiException.badRequest("MERGE_SAME", "서로 다른 키워드를 골라 주세요");
        PlayerKeyword a = heldRow(p, firstId, now), b = heldRow(p, secondId, now);
        List<Keyword> sorted = checkMergeable(p, a.getKeyword(), partsOf(a.getKeyword()), b.getKeyword(), partsOf(b.getKeyword()));
        return new MergePlan(a, b, sorted, MergeKey.text(sorted));
    }

    @Override
    @Transactional(readOnly = true)
    public KeywordDtos.MergePreview mergePreview(long userId, long firstId, long secondId) {
        Player p = playerService.requireCurrent(userId);
        Instant now = Instant.now(clock);
        int hours = settings.getInt(SettingKeys.MERGE_EXPIRE_HOURS);
        try {
            MergePlan plan = planMerge(p, firstId, secondId, now);
            long sum = plan.parts().stream().mapToLong(Keyword::getTrendValue).sum();
            int stars = plan.parts().size();
            double pct = formula.mergeBonusPercent(stars);
            boolean possible = pct > 0 && !bonusCandidates(p, plan.parts(), plan.text(), now).isEmpty();
            return new KeywordDtos.MergePreview(true, null, MergeKey.display(plan.parts()), stars, sum, stars, formula.mergedValue(sum, stars), formula.mergeFailPercent(stars), hours,
                    MergeKey.length(plan.text()), MergeKey.MAX_TEXT_LENGTH, pct, possible, partsDto(plan.parts()));
        } catch (ApiException e) {
            return new KeywordDtos.MergePreview(false, e.getMessage(), null, 0, 0, 0, 0, 0, hours, 0, MergeKey.MAX_TEXT_LENGTH, 0, false, List.of());
        }
    }

    @Override
    @Transactional(readOnly = true)
    public Map<Long, String> mergeBlocked(long userId, long fromId) {
        Player p = playerService.requireCurrent(userId);
        Instant now = Instant.now(clock);
        // 보관함과 합성 구성 원본을 한 번에 읽어 메모리에서 판정한다(카드마다 조회하지 않는다)
        List<PlayerKeyword> rows = holdings.findActiveByPlayer(p.getId(), now, codes.keywordStateId(CodeTables.KW_BANNED));
        Keyword from = rows.stream().map(PlayerKeyword::getKeyword).filter(k -> k.getId().equals(fromId)).findFirst()
                .orElseThrow(() -> ApiException.notFound("NOT_HELD", "보관함에 없는 키워드예요"));
        Map<Long, String> blocked = new LinkedHashMap<>();
        boolean enabled = settings.getInt(SettingKeys.MERGE_ENABLED) != 0;
        List<Long> mergedIds = rows.stream().map(PlayerKeyword::getKeyword).filter(Keyword::isMerged).map(Keyword::getId).toList();
        Map<Long, List<Long>> partIdsOf = new HashMap<>();
        Set<Long> allPartIds = new HashSet<>();
        if (!mergedIds.isEmpty()) {
            for (KeywordMergePart mp : mergeParts.findByKeywordIds(mergedIds)) {
                partIdsOf.computeIfAbsent(mp.getKeywordId(), x -> new ArrayList<>()).add(mp.getPartKeywordId());
                allPartIds.add(mp.getPartKeywordId());
            }
        }
        Map<Long, Keyword> partById = new HashMap<>();
        if (!allPartIds.isEmpty()) keywords.findAllById(allPartIds).forEach(k -> partById.put(k.getId(), k));
        java.util.function.Function<Keyword, List<Keyword>> partsOf = k -> k.isMerged()
                ? partIdsOf.getOrDefault(k.getId(), List.of()).stream().map(partById::get).filter(Objects::nonNull).toList() : List.of(k);
        List<Keyword> fromParts = partsOf.apply(from);
        for (PlayerKeyword row : rows) {
            Keyword other = row.getKeyword();
            if (other.getId().equals(fromId)) continue;
            if (!enabled) { blocked.put(other.getId(), "지금은 합성할 수 없어요"); continue; }
            try { checkMergeable(p, from, fromParts, other, partsOf.apply(other)); } catch (ApiException e) { blocked.put(other.getId(), e.getMessage()); }
        }
        return blocked;
    }

    @Override
    @Transactional
    public KeywordDtos.AutoMergeResult autoMerge(long userId, List<Long> ids) {
        Player found = playerService.requireCurrent(userId);
        Player p = players.findByIdForUpdate(found.getId()).orElseThrow(); // 플레이어는 한 번만 잠근다
        Instant now = Instant.now(clock);
        assertMergeEnabled();
        // 요청한 키워드 중 지금 가진 것(만료 전)만, 무작위 순서로
        List<Long> distinct = new ArrayList<>(new LinkedHashSet<>(ids));
        Map<Long, PlayerKeyword> held = new HashMap<>();
        for (PlayerKeyword row : holdings.findByPlayerIdAndKeywordIdIn(p.getId(), distinct)) if (!row.isExpired(now)) held.put(row.getKeyword().getId(), row);
        List<Long> order = new ArrayList<>(held.keySet());
        Collections.shuffle(order, ThreadLocalRandom.current());
        MergeBatch batch = new MergeBatch();
        // 합성 재료의 구성 원본은 한 번에 읽어 둔다(잠금은 결정이 끝난 뒤 한꺼번에)
        TreeSet<Long> partIds = new TreeSet<>();
        for (Long id : order) { Keyword k = held.get(id).getKeyword(); if (k.isMerged()) partIds.addAll(partIdsOf(k.getId())); }
        if (!partIds.isEmpty()) keywords.findAllById(partIds);
        // 짝짓기: 순서대로 아직 안 쓴 키워드마다, 뒤에서 합칠 수 있는 첫 키워드와 짝을 짓는다(합칠 수 없으면 건너뛴다)
        Set<Long> used = new HashSet<>();
        List<MergePlan> plans = new ArrayList<>();
        for (int i = 0; i < order.size(); i++) {
            Long aId = order.get(i);
            if (used.contains(aId)) continue;
            Keyword ka = held.get(aId).getKeyword();
            List<Keyword> partsA = ka.isMerged() ? partKeywordsOf(ka) : List.of(ka);
            for (int j = i + 1; j < order.size(); j++) {
                Long bId = order.get(j);
                if (used.contains(bId)) continue;
                Keyword kb = held.get(bId).getKeyword();
                List<Keyword> sorted;
                try { sorted = checkMergeable(p, ka, partsA, kb, kb.isMerged() ? partKeywordsOf(kb) : List.of(kb)); } catch (ApiException e) { continue; }
                plans.add(new MergePlan(held.get(aId), held.get(bId), sorted, MergeKey.text(sorted)));
                used.add(aId); used.add(bId);
                break;
            }
        }
        // 실패·보너스를 모두 먼저 정한다(보너스 후보는 한 번만 읽는다)
        plans.replaceAll(plan -> decide(p, plan, now, batch));
        // 재료·구성 원본·보너스 키워드를 번호 순으로 한 번에 잠근다
        TreeSet<Long> lockIds = new TreeSet<>(order);
        lockIds.addAll(partIds);
        for (MergePlan plan : plans) if (plan.bonus() != null) lockIds.add(plan.bonus().getId());
        if (!lockIds.isEmpty()) for (Keyword k : keywords.findAllByIdForUpdate(lockIds)) batch.locked.add(k.getId());
        // 결과가 될 합성 키워드: 이미 있는 것은 한 번에 찾고, 없는 것은 한 문장으로 만든 뒤 다시 찾아 쓴다
        Country country = p.getCountry();
        Map<String, List<Keyword>> keyOf = new LinkedHashMap<>();
        for (MergePlan plan : plans) if (!plan.failed()) { List<Keyword> fp = plan.finalParts(); keyOf.put(MergeKey.identity(fp), fp); }
        if (!keyOf.isEmpty()) {
            for (Keyword k : keywords.findByCountryIdAndNormalizedIn(country.getId(), keyOf.keySet())) batch.existing.put(k.getNormalized(), k);
            Map<String, List<Keyword>> missing = new LinkedHashMap<>();
            for (var e : keyOf.entrySet()) if (!batch.existing.containsKey(e.getKey())) missing.put(e.getKey(), e.getValue());
            if (!missing.isEmpty()) {
                insertMergedKeywords(country, missing, now);
                List<long[]> partRows = new ArrayList<>();
                for (Keyword k : keywords.findByCountryIdAndNormalizedIn(country.getId(), missing.keySet())) {
                    batch.existing.put(k.getNormalized(), k);
                    List<Keyword> fp = missing.get(k.getNormalized());
                    for (Keyword part : fp) partRows.add(new long[]{k.getId(), part.getId()});
                    holdingsStore.registerMerged(k.getId(), fp.stream().map(Keyword::getId).sorted().toList());
                }
                insertMergeParts(partRows);
            }
            TreeSet<Long> mergedIds = new TreeSet<>();
            for (Keyword k : batch.existing.values()) mergedIds.add(k.getId());
            for (Keyword k : keywords.findAllByIdForUpdate(mergedIds)) batch.locked.add(k.getId());
            for (PlayerKeyword row : holdings.findByPlayerIdAndKeywordIdIn(p.getId(), mergedIds)) batch.oldRows.put(row.getKeyword().getId(), row); // 만료됐지만 남은 행은 재사용
        }
        long oldScore = p.getCurrentScore() - p.getLevel();
        List<KeywordDtos.MergeResult> results = new ArrayList<>(plans.size());
        for (int i = 0; i < plans.size(); i++) results.add(mergePlanned(p, plans.get(i), now, batch, i == plans.size() - 1)); // 점수·요약은 마지막에 한 번만 계산한다
        com.trendist.player.dto.PlayerDtos.PlayerSummary summary = playerService.summary(p);
        long totalGained = (p.getCurrentScore() - p.getLevel()) - oldScore;
        List<KeywordDtos.MergeResult> finals = new ArrayList<>(results.size());
        for (int i = 0; i < results.size(); i++) {
            KeywordDtos.MergeResult r = results.get(i);
            finals.add(new KeywordDtos.MergeResult(r.keyword(), r.bonus(), r.bonusPart(), i == results.size() - 1 ? totalGained : r.gained(), summary, r.failed(), r.lost()));
        }
        return new KeywordDtos.AutoMergeResult(finals, held.size() - used.size(), summary);
    }

    /** 새 합성 키워드들을 한 문장으로 넣는다(하나씩 넣으면 합성 수만큼 SQL이 늘어난다). 번호는 넣은 뒤 normalized로 다시 읽어 얻는다 */
    private void insertMergedKeywords(Country country, Map<String, List<Keyword>> merged, Instant now) {
        long sourceId = codes.dataSource(DataSource.INTERNAL).getId(), stateId = codes.keywordStateId(CodeTables.KW_ACTIVE);
        java.sql.Timestamp ts = java.sql.Timestamp.from(now);
        Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC")); // 엔티티와 같이 UTC로 저장한다(hibernate.jdbc.time_zone)
        List<Map.Entry<String, List<Keyword>>> list = new ArrayList<>(merged.entrySet());
        for (int i = 0; i < list.size(); i += 200) {
            List<Map.Entry<String, List<Keyword>>> chunk = list.subList(i, Math.min(list.size(), i + 200));
            StringBuilder sql = new StringBuilder("insert into keywords (country_id, data_source_id, keyword_state_id, text, normalized, trend_value, search_count, add_count, holder_count, view_count, activated_at, is_merged, star_count, created_at, updated_at) values ");
            for (int k = 0; k < chunk.size(); k++) sql.append(k == 0 ? "(?,?,?,?,?,?,0,0,0,0,?,1,?,?,?)" : ",(?,?,?,?,?,?,0,0,0,0,?,1,?,?,?)");
            try {
                jdbc.update(sql.toString(), ps -> {
                    int n = 1;
                    for (var e : chunk) {
                        List<Keyword> fp = e.getValue();
                        ps.setLong(n++, country.getId()); ps.setLong(n++, sourceId); ps.setLong(n++, stateId);
                        ps.setString(n++, MergeKey.text(fp)); ps.setString(n++, e.getKey()); ps.setLong(n++, mergedValueOf(fp));
                        ps.setTimestamp(n++, ts, utc); ps.setInt(n++, fp.size()); ps.setTimestamp(n++, ts, utc); ps.setTimestamp(n++, ts, utc);
                    }
                });
            } catch (DataIntegrityViolationException ex) {
                throw ApiException.conflict("RETRY", "잠시 후 다시 시도해 주세요"); // 같은 합성을 동시에 만들었다
            }
        }
    }

    /** 새 합성 키워드들의 구성 원본 행을 한 문장으로 넣는다(행마다 넣으면 합성 수만큼 SQL이 늘어난다) */
    private void insertMergeParts(List<long[]> rows) {
        if (rows.isEmpty()) return;
        for (int i = 0; i < rows.size(); i += 500) {
            List<long[]> part = rows.subList(i, Math.min(rows.size(), i + 500));
            StringBuilder sql = new StringBuilder("insert into keyword_merge_parts (keyword_id, part_keyword_id) values ");
            List<Object> args = new ArrayList<>();
            for (int k = 0; k < part.size(); k++) { sql.append(k == 0 ? "(?,?)" : ",(?,?)"); args.add(part.get(k)[0]); args.add(part.get(k)[1]); }
            jdbc.update(sql.toString(), args.toArray());
        }
    }

    @Override
    @Transactional
    public KeywordDtos.MergeResult merge(long userId, long firstId, long secondId) {
        Player found = playerService.requireCurrent(userId);
        Player p = players.findByIdForUpdate(found.getId()).orElseThrow(); // 잠금 순서: 플레이어 → 구성 원본(번호 순) → 합성 키워드(번호 순)
        Instant now = Instant.now(clock);
        MergePlan plan = planMerge(p, firstId, secondId, now);
        return mergePlanned(p, plan, now, null, true);
    }

    /**
     * 자동 합성처럼 한 요청에서 여러 합성을 처리할 때 쓰는 묶음 정보: 재료 키워드를 번호 순으로 한 번에 잠가 읽어 두고(locked), 이미 있는 합성 키워드를 한 번에 찾아 두며(existing),
     * 새 합성 키워드와 그 구성 원본 행은 한 문장으로 넣는다. 합성마다 조회·잠금·저장을 반복하지 않게 한다.
     */
    private static final class MergeBatch {
        final Set<Long> locked = new HashSet<>();
        final Map<String, Keyword> existing = new HashMap<>();
        final Map<Long, PlayerKeyword> oldRows = new HashMap<>(); // 합성 결과 키워드의 (만료된 것 포함) 기존 보관함 행
        Set<Long> covered; // 이미 가진 것으로 치는 키워드 번호(보너스 후보에서 뺀다)
        List<Keyword> pool; // 보너스 후보(🔥활성 일반 키워드) 전체, 한 번만 읽는다
    }

    /** 이미 잠가서 읽어 둔 키워드는 영속성 컨텍스트에서 가져오고(조회 없음), 아니면 잠그며 읽는다 */
    private Keyword lockKw(MergeBatch batch, long id) {
        if (batch != null && batch.locked.contains(id)) return keywords.findById(id).orElseThrow();
        return keywords.findByIdForUpdate(id).orElseThrow();
    }

    /**
     * 실패·보너스를 굴린다. 실패(밸런스): 결과 성에 비례한 확률로 합성이 깨져, 재료 중 점수가 낮은 쪽이 사라진다(점수가 같으면 무작위). 분해→재합성으로 보너스를 계속 뽑는 걸 막는다.
     * +1성 보너스(4.44): 결과 성이 높을수록 낮은 확률로, 글자 수가 허용되는 🔥활성 키워드 중 하나가 덤으로 붙는다.
     */
    private MergePlan decide(Player p, MergePlan plan, Instant now, MergeBatch batch) {
        if (ThreadLocalRandom.current().nextDouble(100) < formula.mergeFailPercent(plan.parts().size())) return plan.decide(true, null);
        Keyword bonus = null;
        double pct = formula.mergeBonusPercent(plan.parts().size());
        if (pct > 0 && ThreadLocalRandom.current().nextDouble(100) < pct) bonus = pickBonus(p, plan, now, batch);
        return plan.decide(false, bonus);
    }

    /** 합성 한 쌍을 실제로 처리한다. batch가 있으면 묶음 처리(조회·점수 계산을 줄인다), recompute가 false면 점수·요약은 호출한 쪽이 마지막에 한 번만 계산한다 */
    private KeywordDtos.MergeResult mergePlanned(Player p, MergePlan plan, Instant now, MergeBatch batch, boolean recompute) {
        Country country = p.getCountry();
        if (!plan.decided()) plan = decide(p, plan, now, batch);
        if (plan.failed()) return failMerge(p, plan, now, batch, recompute);
        Keyword bonus = plan.bonus();
        List<Keyword> parts = new ArrayList<>(plan.parts());
        if (bonus != null) parts.add(bonus);

        long oldScore = p.getCurrentScore() - p.getLevel();
        Map<Long, Keyword> lockedParts = new TreeMap<>();
        for (Keyword k : parts) lockedParts.put(k.getId(), lockKw(batch, k.getId()));
        List<Keyword> sorted = MergeKey.sorted(lockedParts.values());
        Keyword target = findOrCreateMerged(country, sorted, now, batch);
        // 합성 키워드 행 잠금(번호 순): 결과 합성 키워드와 재료였던 합성 키워드
        TreeSet<Long> mergedIds = new TreeSet<>();
        mergedIds.add(target.getId());
        List<PlayerKeyword> rows = List.of(plan.rowA(), plan.rowB());
        for (PlayerKeyword row : rows) if (row.getKeyword().isMerged()) mergedIds.add(row.getKeyword().getId());
        Map<Long, Keyword> lockedMerged = new HashMap<>();
        if (batch != null) batch.locked.add(target.getId()); // 방금 만든(또는 찾은) 합성 키워드
        for (Long id : mergedIds) lockedMerged.put(id, lockKw(batch, id));
        target = lockedMerged.get(target.getId());

        // 재료 둘을 지운다. 구성 원본의 가진 사람 수는 합성으로 가진 것도 세므로 그대로이고, 재료였던 합성 키워드는 그 행의 보유자만 줄인다
        List<Long> removedIds = new ArrayList<>();
        for (PlayerKeyword row : rows) {
            Keyword k = row.getKeyword();
            removedIds.add(k.getId());
            if (k.isMerged()) lockedMerged.get(k.getId()).decHolder();
            holdings.delete(row);
        }
        if (batch == null) holdings.flush();
        Instant expires = now.plus(Duration.ofHours(settings.getInt(SettingKeys.MERGE_EXPIRE_HOURS)));
        Optional<PlayerKeyword> old = batch != null ? Optional.ofNullable(batch.oldRows.get(target.getId())) : holdings.findByPlayerIdAndKeywordId(p.getId(), target.getId()); // 만료됐지만 남은 행이 있으면 재사용
        PlayerKeyword newRow;
        if (old.isPresent()) { old.get().renew(now, expires); newRow = old.get(); }
        else newRow = holdings.save(new PlayerKeyword(p, target, now, expires));
        target.incHolder();
        if (bonus != null) {
            // 덤으로 붙은 키워드도 가진 것으로 센다(가진 사람 수 +1, 보유 키워드 수 +1)
            Keyword b = lockedParts.get(bonus.getId());
            long oldTrend = b.getTrendValue();
            b.incHolder();
            p.incHold();
            long nw = updateTrend(b);
            if (batch == null) keywords.flush();
            publishTrendChange(b, oldTrend, nw, p.getId());
        }
        if (batch == null) { keywords.flush(); holdings.flush(); }
        long newScore = recompute ? playerService.recompute(p) : p.getCurrentScore();
        for (Long id : removedIds) events.publishEvent(new GameEvents.HoldingChanged(country.getId(), p.getId(), id, false));
        events.publishEvent(new GameEvents.HoldingChanged(country.getId(), p.getId(), target.getId(), true));
        long gained = (newScore - p.getLevel()) - oldScore;
        KeywordDtos.MyKeyword mine = batch == null ? myKeyword(newRow) : myKeywordInBatch(newRow);
        return new KeywordDtos.MergeResult(mine, bonus != null, bonus == null ? null : partDto(bonus), gained, recompute ? playerService.summary(p) : null, false, null);
    }

    /** 합성 실패: 재료 둘 중 점수가 낮은 쪽을 보관함에서 지운다(합성 키워드면 구성 원본째 사라진다). 나머지 재료는 그대로다. 플레이어를 잠근 상태에서 부른다. */
    private KeywordDtos.MergeResult failMerge(Player p, MergePlan plan, Instant now, MergeBatch batch, boolean recompute) {
        long oldScore = p.getCurrentScore() - p.getLevel();
        PlayerKeyword a = plan.rowA(), b = plan.rowB();
        long ta = a.getKeyword().getTrendValue(), tb = b.getKeyword().getTrendValue();
        PlayerKeyword loser = ta < tb ? a : tb < ta ? b : (ThreadLocalRandom.current().nextBoolean() ? a : b);
        Keyword lk = loser.getKeyword();
        KeywordDtos.LostMaterial lost = new KeywordDtos.LostMaterial(
                lk.isMerged() ? MergeKey.display(MergeKey.sorted(partKeywordsOf(lk))) : lk.getText(), Math.max(1, lk.getStarCount()), lk.getTrendValue());
        Long lostId = lk.getId();
        holdings.delete(loser);
        if (batch == null) holdings.flush();
        removeHolding(p, lostId, now, batch, recompute); // 합성 키워드면 구성 원본의 가진 사람 수·보유 수까지 정리한다
        if (batch == null) keywords.flush();
        long newScore = recompute ? playerService.recompute(p) : p.getCurrentScore();
        return new KeywordDtos.MergeResult(null, false, null, (newScore - p.getLevel()) - oldScore, recompute ? playerService.summary(p) : null, true, lost);
    }

    /** +1성 보너스 후보(4.44): 같은 나라의 🔥활성 일반 키워드 중 이어 붙인 글자 수가 허용 범위 안이고 내가 (직접·합성으로) 갖고 있지 않은 것. */
    private List<Long> bonusCandidates(Player p, List<Keyword> parts, String text, Instant now) {
        Set<Long> covered = heldCoveredIds(p.getId(), now);
        for (Keyword k : parts) covered.add(k.getId());
        int used = MergeKey.length(text);
        List<Long> out = new ArrayList<>();
        for (Object[] r : keywords.findMergeBonusPool(p.getCountry().getId(), codes.keywordStateId(CodeTables.KW_ACTIVE))) {
            long id = ((Number) r[0]).longValue();
            if (covered.contains(id)) continue;
            if (used + MergeKey.length((String) r[1]) > MergeKey.MAX_TEXT_LENGTH) continue;
            out.add(id);
        }
        return out;
    }

    /** 후보 중 균등 무작위 하나(금지어가 생기는 후보는 건너뛴다). 없으면 null이라 보너스 없이 끝난다. */
    private Keyword pickBonus(Player p, MergePlan plan, Instant now, MergeBatch batch) {
        if (batch != null) return pickBonusInBatch(p, plan, now, batch);
        List<Long> ids = new ArrayList<>(bonusCandidates(p, plan.parts(), plan.text(), now));
        Collections.shuffle(ids, ThreadLocalRandom.current());
        String countryCode = p.getCountry().getCode();
        // 후보는 앞에서 MAX_BONUS_TRIES개를 한 번에 읽는다(하나씩 읽으면 보너스 합성이 SQL을 수십 개 더 쓴다)
        Map<Long, Keyword> candidates = new HashMap<>();
        for (Keyword k : keywords.findAllById(ids.subList(0, Math.min(MAX_BONUS_TRIES, ids.size())))) candidates.put(k.getId(), k);
        for (int i = 0; i < Math.min(MAX_BONUS_TRIES, ids.size()); i++) {
            Keyword c = candidates.get(ids.get(i));
            if (c == null || c.isMerged() || !isState(c, CodeTables.KW_ACTIVE)) continue;
            List<Keyword> with = new ArrayList<>(plan.parts());
            with.add(c);
            if (bannedWords.contains(countryCode, MergeKey.joinedNormalized(MergeKey.sorted(with)))) continue;
            return c;
        }
        return null;
    }

    /** 묶음 처리의 보너스 고르기: 가진 것·후보 전체를 처음 한 번만 읽고(조회 2번), 이후 쌍마다는 메모리에서 무작위로 고른다 */
    private Keyword pickBonusInBatch(Player p, MergePlan plan, Instant now, MergeBatch batch) {
        if (batch.pool == null) {
            batch.covered = heldCoveredIds(p.getId(), now);
            List<Long> ids = new ArrayList<>();
            for (Object[] r : keywords.findMergeBonusPool(p.getCountry().getId(), codes.keywordStateId(CodeTables.KW_ACTIVE))) {
                long id = ((Number) r[0]).longValue();
                if (!batch.covered.contains(id)) ids.add(id);
            }
            Collections.shuffle(ids, ThreadLocalRandom.current());
            batch.pool = ids.isEmpty() ? List.of() : new ArrayList<>(keywords.findAllById(ids.subList(0, Math.min(ids.size(), 1500))));
            Collections.shuffle(batch.pool, ThreadLocalRandom.current());
        }
        List<Keyword> pool = batch.pool;
        if (pool.isEmpty()) return null;
        Set<Long> own = new HashSet<>();
        for (Keyword k : plan.parts()) own.add(k.getId());
        int used = MergeKey.length(plan.text()), start = ThreadLocalRandom.current().nextInt(pool.size()), banned = 0;
        String countryCode = p.getCountry().getCode();
        for (int i = 0; i < pool.size() && banned < MAX_BONUS_TRIES; i++) {
            Keyword c = pool.get((start + i) % pool.size());
            if (c.isMerged() || !isState(c, CodeTables.KW_ACTIVE) || batch.covered.contains(c.getId()) || own.contains(c.getId())) continue;
            if (used + MergeKey.length(c.getText()) > MergeKey.MAX_TEXT_LENGTH) continue;
            List<Keyword> with = new ArrayList<>(plan.parts());
            with.add(c);
            if (bannedWords.contains(countryCode, MergeKey.joinedNormalized(MergeKey.sorted(with)))) { banned++; continue; }
            batch.covered.add(c.getId()); // 이 합성으로 가진 것이 되었으니 다음 쌍의 후보에서 뺀다
            return c;
        }
        return null;
    }

    /** 같은 구성의 합성 키워드를 찾고, 없으면 만든다(4.44). 합성 키워드의 상태는 항상 🔥활성, 반영 소스는 internal이다. */
    private Keyword findOrCreateMerged(Country country, List<Keyword> sortedParts, Instant now) { return findOrCreateMerged(country, sortedParts, now, null); }

    private Keyword findOrCreateMerged(Country country, List<Keyword> sortedParts, Instant now, MergeBatch batch) {
        String key = MergeKey.identity(sortedParts);
        if (batch != null) { // 묶음에서는 필요한 합성 키워드를 미리 한꺼번에 찾거나 만들어 두었다
            Keyword m = batch.existing.get(key);
            if (m == null) throw new IllegalStateException("merged keyword not prepared: " + key);
            return m;
        }
        Optional<Keyword> found = keywords.findByCountryIdAndNormalized(country.getId(), key);
        if (found.isPresent()) return found.get();
        Keyword m = Keyword.merged(country, codes.dataSource(DataSource.INTERNAL), codes.keywordState(CodeTables.KW_ACTIVE),
                MergeKey.text(sortedParts), key, sortedParts.size(), now);
        try {
            m = keywords.saveAndFlush(m);
        } catch (DataIntegrityViolationException e) {
            throw ApiException.conflict("RETRY", "잠시 후 다시 시도해 주세요"); // 같은 합성을 동시에 만들었다
        }
        for (Keyword part : sortedParts) mergeParts.save(new KeywordMergePart(m.getId(), part.getId()));
        mergeParts.flush();
        holdingsStore.registerMerged(m.getId(), sortedParts.stream().map(Keyword::getId).sorted().toList()); // 만든 구성을 바로 기억해 둔다
        m.setTrendValue(mergedValueOf(sortedParts));
        return m;
    }

    @Override
    @Transactional(readOnly = true)
    public KeywordDtos.MergedDetail mergedDetail(long userId, long keywordId) {
        Player p = playerService.requireCurrent(userId);
        Keyword m = keywords.findById(keywordId)
                .filter(x -> x.isMerged() && x.getCountry().getId().equals(p.getCountry().getId()))
                .orElseThrow(() -> ApiException.notFound("KEYWORD_NOT_FOUND", "키워드를 찾을 수 없어요"));
        Instant now = Instant.now(clock);
        List<Keyword> parts = MergeKey.sorted(keywords.findAllWithAiByIds(partIdsOf(m.getId())));
        List<KeywordDtos.KeywordCard> cards = parts.stream().filter(k -> !isBanned(k)).map(k -> card(k, p, now)).toList(); // 합성 창을 연 것은 원본의 조회수에 세지 않는다
        long sum = parts.stream().mapToLong(Keyword::getTrendValue).sum();
        Instant mine = holdings.findByPlayerIdAndKeywordId(p.getId(), m.getId()).filter(pk -> !pk.isExpired(now)).map(PlayerKeyword::getExpiresAt).orElse(null);
        return new KeywordDtos.MergedDetail(m.getId(), MergeKey.display(parts), m.getStarCount(), m.getTrendValue(), sum,
                m.getStarCount(), mine, cards);
    }

    // ---- 보유 판정: 합성 키워드를 가지면 구성 원본을 가진 것(4.44)

    /** 이 키워드를 가진 만료 전 보관함 행: 그 키워드 자체이거나 그 키워드가 구성 원본으로 든 합성 키워드. */
    private Optional<PlayerKeyword> covering(long playerId, long keywordId, Instant now) {
        return holdings.findCovering(playerId, keywordId, now).stream().findFirst();
    }

    /** 내가 가진 것으로 치는 키워드 번호: 보관함 행의 키워드와, 합성 키워드의 구성 원본(만료 전, 금지 제외). 고쳐 써도 되는 집합. */
    private Set<Long> heldCoveredIds(long playerId, Instant now) {
        Set<Long> out = new HashSet<>();
        for (PlayerKeyword pk : holdings.findActiveByPlayer(playerId, now, codes.keywordStateId(CodeTables.KW_BANNED))) {
            out.add(pk.getKeyword().getId());
            if (pk.getKeyword().isMerged()) out.addAll(partIdsOf(pk.getKeyword().getId()));
        }
        return out;
    }

    /** 합성 키워드의 구성 원본 번호(번호 순). 처음 한 번만 DB에서 읽고 이후는 메모리: 합성 키워드의 구성은 만들어진 뒤 바뀌지 않는다 */
    private List<Long> partIdsOf(long mergedKeywordId) {
        if (!holdingsStore.hasParts(mergedKeywordId)) holdingsStore.registerMerged(mergedKeywordId, mergeParts.findPartIds(mergedKeywordId));
        return holdingsStore.parts(mergedKeywordId);
    }

    private KeywordDtos.MergedPart partDto(Keyword k) {
        return new KeywordDtos.MergedPart(k.getId(), k.getText(), k.getKeywordState().getName(), k.getTrendValue());
    }

    private static String spaced(List<KeywordDtos.MergedPart> parts) {
        return String.join(" + ", parts.stream().map(KeywordDtos.MergedPart::text).toList());
    }

    private List<KeywordDtos.MergedPart> partsDto(List<Keyword> sorted) { return sorted.stream().map(this::partDto).toList(); }

    /** 합성 키워드 번호 → 구성 원본(이름 순서 규칙대로). */
    private Map<Long, List<KeywordDtos.MergedPart>> mergedPartsOf(Collection<Long> mergedIds) {
        Map<Long, List<KeywordDtos.MergedPart>> out = new HashMap<>();
        if (mergedIds.isEmpty()) return out;
        List<KeywordMergePart> links = mergeParts.findByKeywordIds(mergedIds);
        Map<Long, Keyword> byId = new HashMap<>();
        for (Keyword k : keywords.findAllById(links.stream().map(KeywordMergePart::getPartKeywordId).distinct().toList())) byId.put(k.getId(), k);
        Map<Long, List<Keyword>> grouped = new HashMap<>();
        for (KeywordMergePart l : links) {
            Keyword part = byId.get(l.getPartKeywordId());
            if (part != null) grouped.computeIfAbsent(l.getKeywordId(), x -> new ArrayList<>()).add(part);
        }
        grouped.forEach((id, list) -> out.put(id, partsDto(MergeKey.sorted(list))));
        return out;
    }

    private KeywordDtos.MyKeyword myKeyword(PlayerKeyword pk) {
        Keyword k = pk.getKeyword();
        return myKeyword(pk, k.isMerged() ? mergedPartsOf(List.of(k.getId())) : Map.of());
    }

    private KeywordDtos.MyKeyword myKeyword(PlayerKeyword pk, Map<Long, List<KeywordDtos.MergedPart>> partsOf) {
        Keyword k = pk.getKeyword();
        List<KeywordDtos.MergedPart> parts = partsOf.getOrDefault(k.getId(), List.of());
        String text = k.isMerged() && !parts.isEmpty() ? spaced(parts) : k.getText(); // 합성 키워드는 구성 원본을 띄어 써서 보여 준다
        return new KeywordDtos.MyKeyword(k.getId(), text, k.getKeywordState().getName(), k.getTrendValue(),
                pk.getCreatedAt(), pk.getExpiresAt(), k.isMerged(), k.getStarCount(), parts);
    }

    // ---- 잃기: 구성 원본 단위(4.3, 4.44)

    /** 잃은 원본 하나: 번호·이름·상태, 그 원본 자신의 점수(빼앗는 쪽이 받는 값), 내 유행도가 실제로 줄어든 점수. */
    private record Loss(Long keywordId, String text, String state, long score, long lostPoints) {}

    /**
     * 가진 키워드(금지 제외, 🔥·💤 무관)를 구성 원본 단위로 하나 무작위로 잃는다. 일반 키워드 1개는 1, N성 합성 키워드는 N개로 센다.
     * 합성 키워드에서 원본이 뽑히면 그 원본만 빠지고 성이 하나 낮아진다(남은 시간 유지). 플레이어를 잠근 상태에서 부른다.
     * collision이면 충돌로 잃은 것이라 잃은 횟수와 통계를 올린다.
     */
    private Optional<Loss> loseOneOriginal(Player p, Instant now, boolean collision) {
        List<PlayerKeyword> candidates = holdings.findLosableByPlayer(p.getId(), now, codes.keywordStateId(CodeTables.KW_BANNED));
        if (candidates.isEmpty()) return Optional.empty();
        int total = 0;
        for (PlayerKeyword c : candidates) total += Math.max(1, c.getKeyword().getStarCount());
        int r = ThreadLocalRandom.current().nextInt(total);
        PlayerKeyword pk = candidates.get(0);
        for (PlayerKeyword c : candidates) {
            int w = Math.max(1, c.getKeyword().getStarCount());
            if (r < w) { pk = c; break; }
            r -= w;
        }
        Keyword k = pk.getKeyword();
        if (collision) {
            p.incLose(); // 칭호(4.10). recompute가 칭호를 검사한다
            activity.add(p.getCountry().getId(), com.trendist.stats.support.ActivityCounter.Kind.COLLISION); // 사이트 통계(13.9)
        }
        if (!k.isMerged()) {
            Long id = k.getId();
            String text = k.getText(), state = k.getKeywordState().getName();
            long score = isState(k, CodeTables.KW_ACTIVE) ? k.getTrendValue() : 0; // 💤는 점수에 더해 주지 않았다
            holdings.delete(pk);
            holdings.flush();
            removeHolding(p, id, now);
            return Optional.of(new Loss(id, text, state, score, score));
        }
        List<Long> partIds = partIdsOf(k.getId());
        Long partId = partIds.get(Math.min(r, partIds.size() - 1));
        Keyword part = keywords.findById(partId).orElseThrow();
        long partScore = isState(part, CodeTables.KW_ACTIVE) ? part.getTrendValue() : 0;
        String text = part.getText(), state = part.getKeywordState().getName();
        long lostPoints = dropPartFromHolding(p, pk, partId, now);
        return Optional.of(new Loss(partId, text, state, partScore, lostPoints));
    }

    /**
     * 합성 보관함 행에서 구성 원본 하나를 뺀다(4.44): 성이 하나 낮아지고 남은 시간은 그대로다. 남은 구성이 둘 이상이면 그 구성의 합성 키워드로,
     * 하나면 그 원본 키워드(일반)로 바뀐다. 빠진 원본은 이 플레이어가 더는 가진 것이 아니라 가진 사람 수가 줄고 보유 키워드 수도 1 준다.
     * 내 유행도가 실제로 줄어든 점수를 돌려준다. 플레이어를 잠근 상태에서 부른다. 잠금 순서: 구성 원본(번호 순) → 합성 키워드.
     */
    private long dropPartFromHolding(Player p, PlayerKeyword pk, Long partId, Instant now) {
        Keyword m0 = pk.getKeyword();
        List<Long> allParts = partIdsOf(m0.getId());
        if (!allParts.contains(partId)) return 0;
        List<Long> remaining = new ArrayList<>(allParts);
        remaining.remove(partId);
        Instant created = pk.getCreatedAt(), expires = pk.getExpiresAt();
        long before = m0.getTrendValue();
        Country country = p.getCountry();
        Map<Long, Keyword> lockedParts = new LinkedHashMap<>();
        for (Long id : allParts) lockedParts.put(id, keywords.findByIdForUpdate(id).orElseThrow());
        Keyword m = keywords.findByIdForUpdate(m0.getId()).orElseThrow();
        Keyword target;
        if (remaining.size() >= 2) {
            List<Keyword> rem = MergeKey.sorted(remaining.stream().map(lockedParts::get).toList());
            target = keywords.findByIdForUpdate(findOrCreateMerged(country, rem, now).getId()).orElseThrow();
        } else {
            target = lockedParts.get(remaining.get(0));
        }
        holdings.delete(pk);
        holdings.flush();
        m.decHolder();
        Optional<PlayerKeyword> old = holdings.findByPlayerIdAndKeywordId(p.getId(), target.getId());
        if (old.isPresent()) old.get().renew(created, expires); // 남은 시간 유지
        else holdings.save(new PlayerKeyword(p, target, created, expires));
        if (target.isMerged()) target.incHolder(); // 일반 키워드로 바뀌면 그 원본의 가진 사람 수는 이미 이 플레이어를 세고 있어 그대로다
        Keyword part = lockedParts.get(partId);
        long oldTrend = part.getTrendValue();
        part.decHolder();
        p.decHold();
        if (isState(part, CodeTables.KW_ACTIVE) && part.getDataSource().isInternal()
                && part.getHolderCount() < settings.getInt(SettingKeys.ACTIVATE_HOLDERS)) {
            part.deactivate(codes.keywordState(CodeTables.KW_INACTIVE), now);
            events.publishEvent(new com.trendist.keyword.support.KeywordPageEvents.Deactivated(part.getId())); // 합성 키워드에서 빼낸다(4.44)
        }
        long nw = updateTrend(part);
        keywords.flush();
        holdings.flush();
        publishTrendChange(part, oldTrend, nw, p.getId());
        playerService.recompute(p);
        long after = target.isMerged() || isState(target, CodeTables.KW_ACTIVE) ? target.getTrendValue() : 0;
        events.publishEvent(new GameEvents.HoldingChanged(country.getId(), p.getId(), m.getId(), false));
        events.publishEvent(new GameEvents.HoldingChanged(country.getId(), p.getId(), target.getId(), true));
        return Math.max(0, before - after);
    }

    /**
     * 합성 보관함 행 하나가 통째로 사라질 때(만료·금지·모두 잃기): 구성 원본마다 가진 사람 수와 보유 키워드 수를 줄이고
     * 💤 전환·점수를 고친다. 행은 이미 지운 상태에서 부른다. 잠금 순서: 구성 원본(번호 순) → 합성 키워드.
     */
    private void removeMergedHolding(Player p, Long mergedId) { removeMergedHolding(p, mergedId, null, true); }

    private void removeMergedHolding(Player p, Long mergedId, MergeBatch batch, boolean recompute) {
        Instant now = Instant.now(clock);
        for (Long partId : partIdsOf(mergedId)) {
            Keyword part = lockKw(batch, partId);
            if (part == null) continue;
            long oldTrend = part.getTrendValue();
            part.decHolder();
            p.decHold();
            if (isState(part, CodeTables.KW_ACTIVE) && part.getDataSource().isInternal()
                    && part.getHolderCount() < settings.getInt(SettingKeys.ACTIVATE_HOLDERS)) {
                part.deactivate(codes.keywordState(CodeTables.KW_INACTIVE), now);
                events.publishEvent(new com.trendist.keyword.support.KeywordPageEvents.Deactivated(part.getId())); // 합성 키워드에서 빼낸다(4.44)
            }
            long nw = updateTrend(part);
            publishTrendChange(part, oldTrend, nw, p.getId());
        }
        lockKw(batch, mergedId).decHolder();
        if (batch == null) keywords.flush();
        if (recompute) playerService.recompute(p);
        events.publishEvent(new GameEvents.HoldingChanged(p.getCountry().getId(), p.getId(), mergedId, false));
    }

    // ---------------------------------------------------------------- 내부

    private record Confirmed(DataSource source, double heat) {}

    /** 그 나라의 외부 소스 중 관심도가 기준 이상인 것, 여럿이면 가중치가 가장 큰 것(10.3). */
    private Optional<Confirmed> externalConfirm(String countryCode, String normalized) {
        double threshold = settings.getDouble(SettingKeys.EXTERNAL_CONFIRM_HEAT);
        Confirmed best = null;
        for (ExternalTrendSource s : sources) {
            if (!s.supports(countryCode)) continue;
            OptionalDouble h = s.heat(countryCode, normalized);
            if (h.isEmpty() || h.getAsDouble() < threshold) continue;
            DataSource ds = codes.dataSource(s.sourceName());
            if (ds.getWeight().signum() == 0) continue; // 가중치 0이면 쓰지 않는다
            if (best == null || ds.getWeight().compareTo(best.source().getWeight()) > 0) best = new Confirmed(ds, h.getAsDouble());
        }
        return Optional.ofNullable(best);
    }

    private void tryExternalActivate(Keyword k, Instant now) {
        externalConfirm(k.getCountry().getCode(), k.getNormalized()).ifPresent(c -> {
            long old = k.getTrendValue();
            if (isListSource(c.source())) k.holdExternal(c.source(), externalHoldUntil(now));
            else k.setDataSource(c.source());
            k.activate(codes.keywordState(CodeTables.KW_ACTIVE), now);
            activeIdCache.remove(k.getCountry().getId()); // 구슬 후보 목록에 바로 반영
            long nw = updateTrend(k);
            publishTrendChange(k, old, nw, null);
        });
    }

    private Keyword createKeyword(Country country, String text, String normalized, Optional<Confirmed> ext, Instant now) {
        DataSource source = ext.map(Confirmed::source).orElseGet(() -> codes.dataSource(DataSource.INTERNAL));
        KeywordState state = codes.keywordState(ext.isPresent() ? CodeTables.KW_ACTIVE : CodeTables.KW_INACTIVE);
        Keyword k = new Keyword(country, source, state, text, normalized);
        if (ext.isPresent()) {
            k.activate(state, now);
            if (isListSource(source)) k.holdExternal(source, externalHoldUntil(now));
        }
        try {
            k = keywords.saveAndFlush(k);
        } catch (DataIntegrityViolationException e) {
            // 같은 단어를 동시에 만들었다. 이 트랜잭션은 되돌리고 클라이언트가 다시 시도한다(다음 시도는 기존 행을 쓴다)
            throw ApiException.conflict("RETRY", "잠시 후 다시 시도해 주세요");
        }
        updateTrend(k);
        activeIdCache.remove(country.getId()); // 새 키워드가 구슬 후보 목록에 바로 들어가게
        return k;
    }

    private long updateTrend(Keyword k) {
        long v = k.isMerged() ? mergedTrend(k)
                : formula.trendValue(isState(k, CodeTables.KW_ACTIVE), k.getHolderCount(), k.getDataSource().getWeight().doubleValue(),
                        population.get(k.getCountry().getId()), normalizedLength(k));
        k.setTrendValue(v);
        return v;
    }

    /** 정규화 값(공백 제거)의 글자 수: 글자 수 가점(4.44)에 쓴다. */
    private static int normalizedLength(Keyword k) { return k.getNormalized().codePointCount(0, k.getNormalized().length()); }

    /** 합성 키워드의 점수를 미리 읽어 둔 구성 원본으로 계산한다(mergedTrend와 같은 값, 조회 없음). */
    private long mergedFromBatch(Keyword m, Map<Long, List<Long>> partsOf, Map<Long, Keyword> partById) {
        long sum = 0;
        int stars = 0;
        for (Long id : partsOf.getOrDefault(m.getId(), List.of())) {
            Keyword part = partById.get(id);
            if (part == null) continue;
            sum += part.getTrendValue();
            stars++;
        }
        return formula.mergedValue(sum, stars);
    }

    /** 합성 키워드의 점수(4.44): 구성 원본(1성) 키워드 점수의 합 × 별 개수. 💤·금지 원본은 점수가 0이라 보태지 않는다. */
    /** 구성 원본 엔티티로 합성 키워드의 점수를 구한다(조회 없음) */
    private long mergedValueOf(List<Keyword> parts) {
        long sum = 0;
        for (Keyword part : parts) sum += part.getTrendValue();
        return formula.mergedValue(sum, parts.size());
    }

    private long mergedTrend(Keyword m) {
        long sum = 0;
        int stars = 0;
        for (Keyword part : keywords.findAllById(partIdsOf(m.getId()))) { sum += part.getTrendValue(); stars++; }
        return formula.mergedValue(sum, stars);
    }

    private void publishTrendChange(Keyword k, long oldTrend, long newTrend, Long excludePlayerId) {
        if (oldTrend == newTrend) return;
        dirtyKeywords.add(k.getId());
        events.publishEvent(new GameEvents.KeywordTrendChanged(k.getCountry().getId(), k.getId(),
                newTrend - oldTrend, excludePlayerId));
    }

    @Override
    @Transactional(readOnly = true)
    public KeywordDtos.KeywordCard detail(long userId, long keywordId, String ip, String userAgent) {
        Player p = playerService.requireCurrent(userId);
        Keyword k = keywords.findWithAiById(keywordId)
                .filter(x -> !x.isMerged() && x.getCountry().getId().equals(p.getCountry().getId()) && !isBanned(x) && !bannedWords.contains(p.getCountry().getCode(), x.getNormalized()))
                .orElseThrow(() -> ApiException.notFound("KEYWORD_NOT_FOUND", "키워드를 찾을 수 없어요"));
        viewCounter.hit(k.getId(), ip, userAgent); // 볼 수 있는 키워드일 때만 센다(없거나 금지면 위에서 이미 404)
        return card(k, p, Instant.now(clock));
    }

    private KeywordDtos.KeywordCard card(Keyword k, Player p, Instant now) {
        Optional<PlayerKeyword> mine = covering(p.getId(), k.getId(), now); // 합성 키워드로 가진 것도 가진 것(4.44)
        String ai = k.getAiComment() == null ? null : k.getAiComment().getComment();
        return new KeywordDtos.KeywordCard(k.getId(), k.getText(), k.getKeywordState().getName(), k.getTrendValue(),
                k.getHolderCount(), k.getAddCount(),
                k.getSearchCount() + searchCounter.pending(k.getId()),
                k.getViewCount() + viewCounter.pendingOf(k.getId()), mine.isPresent(),
                mine.map(PlayerKeyword::getExpiresAt).orElse(null),
                ai, ai != null && aiRequests.existsByKeywordIdAndPlayerIdAndHandledAtIsNull(k.getId(), p.getId()));
    }

    /** 목록형 외부 소스 유지 끝 시각: 지금 + 설정 시간(기본 168시간 = 7일). */
    private Instant externalHoldUntil(Instant now) {
        return now.plus(Duration.ofHours(settings.getInt(SettingKeys.EXTERNAL_HOLD_HOURS)));
    }

    /** 유지 기간(기본 7일)을 두고 끝나면 다시 보는 소스: 목록에 오른 동안만 확인되는 google, 관리자가 넣은 admin. */
    private boolean isListSource(DataSource s) { return DataSource.GOOGLE.equals(s.getName()) || DataSource.ADMIN.equals(s.getName()); }

    private Country countryOf(String code) {
        return countries.requireOpen(code);
    }

    private boolean isBanned(Keyword k) { return isState(k, CodeTables.KW_BANNED); }

    private boolean isState(Keyword k, String name) {
        return k.getKeywordState().getId().equals(codes.keywordStateId(name));
    }
}

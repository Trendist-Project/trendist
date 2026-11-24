package com.trendist.keyword.holding;

import com.trendist.keyword.entity.Keyword;
import com.trendist.keyword.entity.PlayerKeyword;
import com.trendist.keyword.memory.HoldingsStore;
import com.trendist.keyword.memory.HoldingsStore.Holding;
import com.trendist.keyword.repository.KeywordMergePartRepository;
import com.trendist.keyword.repository.KeywordRepository;
import com.trendist.keyword.repository.PlayerKeywordRepository;
import com.trendist.player.entity.Player;
import com.trendist.player.repository.PlayerRepository;
import jakarta.annotation.PreDestroy;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.Pageable;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@link Holdings}의 메모리 구현(`trendist.memory-holdings=true`일 때만, docs/plans/memory-holdings.md). 보관함 행은 서버 메모리({@link HoldingsStore})가 원천이고,
 * DB의 player_keywords는 시작할 때 읽고 정상 종료할 때 저장한다(그 사이에는 쓰지 않는다).
 *
 * 서비스는 트랜잭션이 실패하면 DB가 되돌려지는 것에 기대고 있어서, 메모리도 같게 한다: 트랜잭션 안의 쓰기는 그 트랜잭션의 {@link Journal}에만 쌓이고(같은 트랜잭션의 읽기는 이것을 겹쳐 본다),
 * 커밋된 뒤에야 저장소에 반영되며 롤백되면 버려진다. 트랜잭션 밖의 쓰기는 바로 반영한다.
 * 키워드의 상태·점수는 아직 DB 엔티티가 원천이라(다음 단계) 행을 돌려줄 때 키워드를 한 번에 읽어 붙인다.
 */
@Component
@ConditionalOnProperty(name = "trendist.memory-holdings", havingValue = "true")
@RequiredArgsConstructor
public class MemoryHoldings implements Holdings {
    private static final Logger log = LoggerFactory.getLogger(MemoryHoldings.class);
    /** 롤백 전까지 지워진 것으로 보이는 행의 표시 */
    private static final Holding TOMB = new Holding(-1, -1, Instant.EPOCH, Instant.EPOCH);

    private final HoldingsStore store;
    private final KeywordRepository keywords;
    private final KeywordMergePartRepository mergeParts;
    private final PlayerRepository players;
    private final PlayerKeywordRepository rowsRepo;
    private final TransactionTemplate tx;
    @PersistenceContext private EntityManager em;

    // ---------------------------------------------------------------- 트랜잭션 저널

    /** 한 트랜잭션의 쓰기(플레이어 번호 → 키워드 번호 → 새 행 또는 TOMB). 커밋되면 저장소에 반영하고 롤백되면 버린다 */
    private final class Journal implements TransactionSynchronization {
        final Map<Long, Map<Long, Holding>> pending = new HashMap<>();

        Holding get(long playerId, long keywordId) {
            Map<Long, Holding> m = pending.get(playerId);
            return m == null ? null : m.get(keywordId);
        }

        void put(long playerId, long keywordId, Holding h) { pending.computeIfAbsent(playerId, k -> new HashMap<>()).put(keywordId, h); }

        @Override
        public void afterCommit() {
            for (Map.Entry<Long, Map<Long, Holding>> p : pending.entrySet()) {
                for (Map.Entry<Long, Holding> e : p.getValue().entrySet()) {
                    Holding h = e.getValue();
                    if (h == TOMB) store.remove(p.getKey(), e.getKey());
                    else store.upsert(h.id(), p.getKey(), e.getKey(), h.createdAt(), h.expiresAt());
                }
            }
        }
    }

    private Journal journal(boolean create) {
        if (!TransactionSynchronizationManager.isSynchronizationActive() || !TransactionSynchronizationManager.isActualTransactionActive()) return null;
        for (TransactionSynchronization s : TransactionSynchronizationManager.getSynchronizations()) if (s instanceof Journal j) return j;
        if (!create) return null;
        Journal j = new Journal();
        TransactionSynchronizationManager.registerSynchronization(j);
        return j;
    }

    // ---------------------------------------------------------------- 저널을 겹쳐 본 읽기·쓰기

    /** 이 플레이어가 이 키워드를 직접 가진 행(만료된 것 포함). 없으면 null */
    private Holding find(long playerId, long keywordId) {
        Journal j = journal(false);
        if (j != null) { Holding o = j.get(playerId, keywordId); if (o != null) return o == TOMB ? null : o; }
        return store.row(playerId, keywordId).orElse(null);
    }

    /** 이 플레이어의 모든 행(만료된 것 포함, 키워드 번호 → 행) */
    private Map<Long, Holding> rowsOf(long playerId) {
        Map<Long, Holding> out = new LinkedHashMap<>();
        for (Holding h : store.rowsOf(playerId)) out.put(h.keywordId(), h);
        Journal j = journal(false);
        if (j != null) {
            Map<Long, Holding> over = j.pending.get(playerId);
            if (over != null) over.forEach((k, h) -> { if (h == TOMB) out.remove(k); else out.put(k, h); });
        }
        return out;
    }

    private Set<Long> playersWithRows() {
        Set<Long> ids = new HashSet<>(store.playerIds());
        Journal j = journal(false);
        if (j != null) ids.addAll(j.pending.keySet());
        return ids;
    }

    private void put(long playerId, long keywordId, long id, Instant createdAt, Instant expiresAt) {
        Journal j = journal(true);
        if (j != null) j.put(playerId, keywordId, new Holding(id, keywordId, createdAt, expiresAt));
        else store.upsert(id, playerId, keywordId, createdAt, expiresAt);
    }

    private void drop(long playerId, long keywordId) {
        Journal j = journal(true);
        if (j != null) j.put(playerId, keywordId, TOMB);
        else store.remove(playerId, keywordId);
    }

    /** 행을 고쳤다(만료·얻은 시각 갱신): 저널(또는 저장소)에 반영한다 */
    void touch(long playerId, long keywordId, long id, Instant createdAt, Instant expiresAt) { put(playerId, keywordId, id, createdAt, expiresAt); }

    // ---------------------------------------------------------------- 행 객체

    /** 서비스에 돌려주는 행: PlayerKeyword처럼 읽고, 시각을 고치면(renew) 메모리에 반영한다. DB에는 저장하지 않는다 */
    private static final class MemoryRow extends PlayerKeyword {
        private final long rowId, playerId, keywordId;
        private final MemoryHoldings owner;

        MemoryRow(long rowId, Player player, Keyword keyword, Instant createdAt, Instant expiresAt, MemoryHoldings owner) {
            super(player, keyword, createdAt, expiresAt);
            this.rowId = rowId; this.playerId = player.getId(); this.keywordId = keyword.getId(); this.owner = owner;
        }

        @Override public Long getId() { return rowId; }

        @Override
        public void renew(Instant now, Instant expiresAt) {
            super.renew(now, expiresAt);
            owner.touch(playerId, keywordId, rowId, now, expiresAt);
        }
    }

    private Map<Long, Keyword> loadKeywords(Collection<Long> ids) {
        Map<Long, Keyword> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        for (Keyword k : keywords.findAllById(new HashSet<>(ids))) out.put(k.getId(), k);
        return out;
    }

    private PlayerKeyword toRow(long playerId, Holding h, Map<Long, Keyword> byId) {
        Keyword k = byId.get(h.keywordId());
        if (k == null) return null; // 키워드가 사라졌다(있을 수 없는 일이지만 행은 버린다)
        return new MemoryRow(h.id(), em.getReference(Player.class, playerId), k, h.createdAt(), h.expiresAt(), this);
    }

    /** 합성 키워드의 구성 원본(처음 한 번만 읽고 저장소에 기억한다: 합성 키워드의 구성은 바뀌지 않는다) */
    private List<Long> parts(long mergedKeywordId) {
        if (!store.hasParts(mergedKeywordId)) store.registerMerged(mergedKeywordId, mergeParts.findPartIds(mergedKeywordId));
        return store.parts(mergedKeywordId);
    }

    private static boolean isBanned(Keyword k, Long bannedStateId) { return k.getKeywordState().getId().equals(bannedStateId); }

    // ---------------------------------------------------------------- Holdings

    @Override
    public Optional<PlayerKeyword> findById(Long id) {
        long[] at = store.locate(id);
        if (at == null) return Optional.empty();
        Holding h = find(at[0], at[1]);
        if (h == null || h.id() != id) return Optional.empty();
        return Optional.ofNullable(toRow(at[0], h, loadKeywords(List.of(h.keywordId()))));
    }

    @Override
    public Optional<PlayerKeyword> findByPlayerIdAndKeywordId(Long playerId, Long keywordId) {
        Holding h = find(playerId, keywordId);
        return h == null ? Optional.empty() : Optional.ofNullable(toRow(playerId, h, loadKeywords(List.of(keywordId))));
    }

    @Override
    public List<PlayerKeyword> findByPlayerIdAndKeywordIdIn(Long playerId, Collection<Long> keywordIds) {
        List<Holding> hs = new ArrayList<>();
        for (Long id : keywordIds) { Holding h = find(playerId, id); if (h != null) hs.add(h); }
        Map<Long, Keyword> byId = loadKeywords(hs.stream().map(Holding::keywordId).toList());
        List<PlayerKeyword> out = new ArrayList<>();
        for (Holding h : hs) { PlayerKeyword r = toRow(playerId, h, byId); if (r != null) out.add(r); }
        return out;
    }

    @Override
    public List<PlayerKeyword> findCovering(Long playerId, Long keywordId, Instant now) {
        List<Holding> active = rowsOf(playerId).values().stream().filter(h -> !h.expired(now)).toList();
        Map<Long, Keyword> byId = loadKeywords(active.stream().map(Holding::keywordId).toList());
        List<PlayerKeyword> out = new ArrayList<>();
        for (Holding h : active) {
            Keyword k = byId.get(h.keywordId());
            if (k == null) continue;
            if (h.keywordId() == keywordId || (k.isMerged() && parts(k.getId()).contains(keywordId))) { PlayerKeyword r = toRow(playerId, h, byId); if (r != null) out.add(r); }
        }
        return out;
    }

    private List<PlayerKeyword> activeNotBanned(long playerId, Instant now, Long bannedStateId, Comparator<PlayerKeyword> order) {
        List<Holding> active = rowsOf(playerId).values().stream().filter(h -> !h.expired(now)).toList();
        Map<Long, Keyword> byId = loadKeywords(active.stream().map(Holding::keywordId).toList());
        List<PlayerKeyword> out = new ArrayList<>();
        for (Holding h : active) {
            Keyword k = byId.get(h.keywordId());
            if (k == null || isBanned(k, bannedStateId)) continue;
            PlayerKeyword r = toRow(playerId, h, byId);
            if (r != null) out.add(r);
        }
        if (order != null) out.sort(order);
        return out;
    }

    @Override
    public List<PlayerKeyword> findActiveByPlayer(Long playerId, Instant now, Long bannedStateId) {
        return activeNotBanned(playerId, now, bannedStateId, Comparator.comparing(PlayerKeyword::getCreatedAt).reversed());
    }

    @Override
    public List<PlayerKeyword> findLosableByPlayer(Long playerId, Instant now, Long bannedStateId) { return activeNotBanned(playerId, now, bannedStateId, null); }

    @Override
    public List<PlayerKeyword> findTopByPlayer(Long playerId, Instant now, Long bannedStateId, Pageable pageable) {
        List<PlayerKeyword> all = activeNotBanned(playerId, now, bannedStateId,
                Comparator.<PlayerKeyword>comparingLong(r -> r.getKeyword().getTrendValue()).reversed().thenComparing(Comparator.comparing(PlayerKeyword::getCreatedAt).reversed()));
        return pageable.isUnpaged() ? all : all.stream().limit(pageable.getPageSize()).toList();
    }

    @Override
    public long sumActiveTrendValue(Long playerId, Instant now, Long activeStateId) {
        List<Holding> active = rowsOf(playerId).values().stream().filter(h -> !h.expired(now)).toList();
        Map<Long, Keyword> byId = loadKeywords(active.stream().map(Holding::keywordId).toList());
        long sum = 0;
        for (Holding h : active) { Keyword k = byId.get(h.keywordId()); if (k != null && k.getKeywordState().getId().equals(activeStateId)) sum += k.getTrendValue(); }
        return sum;
    }

    @Override
    public long countUnexpired(Long playerId, Instant now) {
        List<Holding> active = rowsOf(playerId).values().stream().filter(h -> !h.expired(now)).toList();
        Map<Long, Keyword> byId = loadKeywords(active.stream().map(Holding::keywordId).toList());
        long n = 0;
        for (Holding h : active) { Keyword k = byId.get(h.keywordId()); if (k != null) n += k.getStarCount(); }
        return n;
    }

    @Override
    public List<Long> findHolderPlayerIds(Long keywordId, Instant now) {
        List<Long> out = new ArrayList<>();
        Set<Long> candidates = new HashSet<>(store.holdersIncludingExpired(keywordId));
        Journal j = journal(false);
        if (j != null) for (Map.Entry<Long, Map<Long, Holding>> p : j.pending.entrySet()) if (p.getValue().containsKey(keywordId)) candidates.add(p.getKey());
        for (long pid : candidates) { Holding h = find(pid, keywordId); if (h != null && !h.expired(now)) out.add(pid); }
        return out;
    }

    @Override
    public long countPlusedSince(Long keywordId, Instant since) {
        long n = 0;
        Set<Long> candidates = new HashSet<>(store.holdersIncludingExpired(keywordId));
        Journal j = journal(false);
        if (j != null) for (Map.Entry<Long, Map<Long, Holding>> p : j.pending.entrySet()) if (p.getValue().containsKey(keywordId)) candidates.add(p.getKey());
        for (long pid : candidates) { Holding h = find(pid, keywordId); if (h != null && !h.createdAt().isBefore(since)) n++; }
        return n;
    }

    @Override
    public List<Object[]> countHoldingPlayersByCountry(Instant now, Long withdrawnStateId) {
        List<Long> holders = new ArrayList<>();
        for (long pid : playersWithRows()) if (rowsOf(pid).values().stream().anyMatch(h -> !h.expired(now))) holders.add(pid);
        Map<Long, Long> byCountry = new HashMap<>();
        for (int i = 0; i < holders.size(); i += 500) {
            for (Object[] r : players.countByCountryExcludingWithdrawn(holders.subList(i, Math.min(holders.size(), i + 500)), withdrawnStateId))
                byCountry.merge(((Number) r[0]).longValue(), ((Number) r[1]).longValue(), Long::sum);
        }
        List<Object[]> out = new ArrayList<>();
        byCountry.forEach((c, n) -> out.add(new Object[]{c, n}));
        return out;
    }

    // ---- 만료·금지 정리

    /** 모든 플레이어의 (플레이어 번호, 행) */
    private List<long[]> allRowRefs() {
        List<long[]> out = new ArrayList<>();
        for (long pid : playersWithRows()) for (Holding h : rowsOf(pid).values()) out.add(new long[]{pid, h.keywordId(), h.id()});
        return out;
    }

    @Override
    public List<Long> findExpiredIds(Instant now, Pageable pageable) {
        List<Holding> expired = new ArrayList<>();
        for (long pid : playersWithRows()) for (Holding h : rowsOf(pid).values()) if (h.expired(now)) expired.add(h);
        expired.sort(Comparator.comparing(Holding::expiresAt));
        return expired.stream().limit(pageable.isUnpaged() ? Long.MAX_VALUE : pageable.getPageSize()).map(Holding::id).toList();
    }

    @Override
    public int deleteIfExpired(Long id, Instant now) {
        long[] at = store.locate(id);
        if (at == null) return 0;
        Holding h = find(at[0], at[1]);
        if (h == null || h.id() != id || !h.expired(now)) return 0;
        drop(at[0], at[1]);
        return 1;
    }

    @Override
    public List<Long> findIdsHoldingBanned(String countryCode, String normalized, boolean contain) {
        List<long[]> refs = allRowRefs();
        Map<Long, Keyword> byId = loadKeywords(refs.stream().map(r -> r[1]).toList());
        List<Long> out = new ArrayList<>();
        for (long[] r : refs) {
            Keyword k = byId.get(r[1]);
            if (k != null && k.getCountry().getCode().equals(countryCode) && (k.getNormalized().equals(normalized) || (contain && k.getNormalized().contains(normalized)))) out.add(r[2]);
        }
        return out;
    }

    @Override
    public List<Object[]> findMergedRowsWithBannedPart(String countryCode, String normalized, boolean contain) {
        List<long[]> refs = allRowRefs();
        Map<Long, Keyword> byId = loadKeywords(refs.stream().map(r -> r[1]).toList());
        Map<Long, List<Long>> partsOfRow = new HashMap<>();
        Set<Long> partIds = new HashSet<>();
        for (long[] r : refs) {
            Keyword k = byId.get(r[1]);
            if (k == null || !k.isMerged()) continue;
            List<Long> ps = parts(k.getId());
            partsOfRow.put(r[2], ps);
            partIds.addAll(ps);
        }
        Map<Long, Keyword> partById = loadKeywords(partIds);
        List<Object[]> out = new ArrayList<>();
        for (long[] r : refs) {
            for (Long partId : partsOfRow.getOrDefault(r[2], List.of())) {
                Keyword part = partById.get(partId);
                if (part != null && part.getCountry().getCode().equals(countryCode) && (part.getNormalized().equals(normalized) || (contain && part.getNormalized().contains(normalized))))
                    out.add(new Object[]{r[2], partId});
            }
        }
        return out;
    }

    @Override
    public List<Long> findMergedRowIdsWithPart(Long partId, Instant now) {
        List<long[]> refs = allRowRefs();
        Map<Long, Keyword> byId = loadKeywords(refs.stream().map(r -> r[1]).toList());
        List<Long> out = new ArrayList<>();
        for (long[] r : refs) {
            Keyword k = byId.get(r[1]);
            Holding h = find(r[0], r[1]);
            if (k != null && h != null && !h.expired(now) && k.isMerged() && parts(k.getId()).contains(partId)) out.add(r[2]);
        }
        return out;
    }

    @Override
    public List<Long> findMergedRowIdsByCountry(String countryCode) {
        List<long[]> refs = allRowRefs();
        Map<Long, Keyword> byId = loadKeywords(refs.stream().map(r -> r[1]).toList());
        List<Long> out = new ArrayList<>();
        for (long[] r : refs) { Keyword k = byId.get(r[1]); if (k != null && k.isMerged() && k.getCountry().getCode().equals(countryCode)) out.add(r[2]); }
        return out;
    }

    // ---- 쓰기

    @Override
    public PlayerKeyword save(PlayerKeyword row) {
        long playerId = row.getPlayer().getId(), keywordId = row.getKeyword().getId();
        Holding old = find(playerId, keywordId);
        long id = old != null ? old.id() : store.newId();
        put(playerId, keywordId, id, row.getCreatedAt(), row.getExpiresAt());
        return new MemoryRow(id, row.getPlayer(), row.getKeyword(), row.getCreatedAt(), row.getExpiresAt(), this);
    }

    @Override public void delete(PlayerKeyword row) { drop(row.getPlayer().getId(), row.getKeyword().getId()); }

    @Override public void deleteAll(Iterable<PlayerKeyword> rows) { for (PlayerKeyword r : rows) delete(r); }

    @Override public void flush() { /* 행은 고치는 즉시 메모리(저널)에 반영된다 */ }

    // ---------------------------------------------------------------- 시작·종료

    /** 시작할 때 DB의 보관함을 메모리로 올리고, 가진 사람 수·보유 수를 보관함에서 다시 센 값으로 바로잡는다 */
    @EventListener(ApplicationReadyEvent.class)
    public void loadFromDb() {
        List<HoldingsStore.Row> rows = new ArrayList<>();
        tx.executeWithoutResult(st -> {
            for (Object[] r : rowsRepo.findAllRaw()) rows.add(new HoldingsStore.Row(((Number) r[0]).longValue(), ((Number) r[1]).longValue(), ((Number) r[2]).longValue(), (Instant) r[3], (Instant) r[4]));
        });
        store.load(rows);
        log.info("memory holdings: loaded {} rows from DB", rows.size());
        try { reconcileCounts(); } catch (RuntimeException e) { log.error("memory holdings: reconcile failed", e); }
    }

    /**
     * 서버가 갑자기 죽었다면 키워드의 가진 사람 수나 플레이어의 보유 수가 보관함과 어긋나 있을 수 있다(카운터는 1분마다 저장하므로). 시작할 때 보관함(만료 전)에서
     * 다시 세어 바로잡는다: 키워드의 가진 사람 수 = 그 키워드를 직접 가졌거나 그것이 든 합성 키워드를 가진 플레이어 수, 플레이어의 보유 수 = 가진 행의 성(구성 수) 합.
     */
    public void reconcileCounts() {
        Instant now = Instant.now();
        List<HoldingsStore.Row> active = store.exportAll().stream().filter(r -> r.expiresAt().isAfter(now)).toList();
        Map<Long, Keyword> kws = loadKeywords(active.stream().map(HoldingsStore.Row::keywordId).toList());
        Map<Long, Long> holders = new HashMap<>(), hold = new HashMap<>();
        for (HoldingsStore.Row r : active) {
            Keyword k = kws.get(r.keywordId());
            if (k == null) continue;
            holders.merge(k.getId(), 1L, Long::sum);
            if (k.isMerged()) for (Long part : parts(k.getId())) holders.merge(part, 1L, Long::sum);
            hold.merge(r.playerId(), (long) Math.max(1, k.getStarCount()), Long::sum);
        }
        int[] fixed = new int[2];
        tx.executeWithoutResult(st -> {
            for (Keyword k : keywords.findForHolderReconcile(holders.isEmpty() ? List.of(-1L) : holders.keySet())) {
                long expected = holders.getOrDefault(k.getId(), 0L);
                if (k.getHolderCount() != expected) { k.setHolderCount(expected); fixed[0]++; }
            }
            for (Player p : players.findForHoldReconcile(hold.isEmpty() ? List.of(-1L) : hold.keySet())) {
                int expected = (int) (long) hold.getOrDefault(p.getId(), 0L);
                if (p.getHoldCount() != expected) { p.setHoldCount(expected); fixed[1]++; }
            }
        });
        if (fixed[0] + fixed[1] > 0) log.warn("memory holdings: reconciled {} keyword holder counts and {} player hold counts", fixed[0], fixed[1]);
    }

    /** 1분마다 바뀐 보관함 행만 DB에 반영한다(정상 종료할 때도 같은 저장을 한 번 더 한다) */
    @Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    public void flushToDb() {
        List<HoldingsStore.Change> changes = store.drainDirty();
        if (changes.isEmpty()) return;
        try {
            Instant now = Instant.now();
            tx.executeWithoutResult(st -> {
                Map<Long, List<HoldingsStore.Change>> byPlayer = new LinkedHashMap<>();
                for (HoldingsStore.Change c : changes) byPlayer.computeIfAbsent(c.playerId(), k -> new ArrayList<>()).add(c);
                for (Map.Entry<Long, List<HoldingsStore.Change>> e : byPlayer.entrySet()) {
                    long pid = e.getKey();
                    Map<Long, PlayerKeyword> existing = new HashMap<>();
                    for (PlayerKeyword pk : rowsRepo.findByPlayerIdAndKeywordIdIn(pid, e.getValue().stream().map(HoldingsStore.Change::keywordId).toList())) existing.put(pk.getKeyword().getId(), pk);
                    for (HoldingsStore.Change c : e.getValue()) {
                        PlayerKeyword db = existing.get(c.keywordId());
                        boolean keep = c.holding() != null && c.holding().expiresAt().isAfter(now); // 없어졌거나 이미 만료된 행은 DB에서도 지운다
                        if (!keep) { if (db != null) rowsRepo.delete(db); }
                        else if (db != null) db.renew(c.holding().createdAt(), c.holding().expiresAt());
                        else rowsRepo.save(new PlayerKeyword(em.getReference(Player.class, pid), em.getReference(Keyword.class, c.keywordId()), c.holding().createdAt(), c.holding().expiresAt()));
                    }
                }
            });
            log.info("memory holdings: synced {} changed rows to DB", changes.size());
        } catch (RuntimeException e) {
            log.warn("memory holdings: sync of {} rows failed; will retry", changes.size(), e);
            store.markDirty(changes);
        }
    }

    /** 정상 종료할 때 바뀐 행을 마지막으로 저장한다 */
    @PreDestroy
    public void saveToDb() {
        log.info("memory holdings: shutdown flush");
        flushToDb();
    }
}

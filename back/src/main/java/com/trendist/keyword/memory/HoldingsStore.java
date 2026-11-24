package com.trendist.keyword.memory;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.ToIntFunction;

/**
 * 보관함(플레이어가 가진 키워드와 만료 시각)을 서버 메모리에 두는 저장소. 메모리가 원천이고 DB(player_keywords)는 시작할 때 읽고 정상 종료할 때 저장하는 곳이다
 * (docs/plans/memory-holdings.md). 키워드는 24시간이면 만료되는 값이라 서버가 꺼져 사라져도 감수하는 일회성 데이터로 본다.
 *
 * 행은 "플레이어가 직접 가진 키워드" 하나다. 합성 키워드도 한 행이고, 그 구성 원본은 합성 키워드의 구성(partsOf)에서 알아낸다(합성으로 가진 원본도 가진 것으로 친다, 4.44).
 * 같은 플레이어에 대한 여러 단계 작업(읽고 고치기)은 {@link #lock(long)}으로 플레이어 단위로 직렬화해서 부른다. 개별 메서드는 단독으로도 안전하다.
 */
@org.springframework.stereotype.Component
public final class HoldingsStore {
    /** 보관함 행 하나: 행 번호(서비스가 행을 가리키는 데 쓴다), 직접 가진 키워드 번호, 얻은(마지막으로 갱신한) 시각, 만료 시각 */
    public record Holding(long id, long keywordId, Instant createdAt, Instant expiresAt) {
        public boolean expired(Instant now) { return !expiresAt.isAfter(now); }
    }

    /** 시작할 때 읽고 종료할 때 저장하는 데 쓰는 한 줄(id가 0이면 새 번호를 준다) */
    public record Row(long id, long playerId, long keywordId, Instant createdAt, Instant expiresAt) {}

    private final Map<Long, Map<Long, Holding>> byPlayer = new ConcurrentHashMap<>();
    private final Map<Long, Set<Long>> holdersOf = new ConcurrentHashMap<>(); // 키워드 번호 → 그것을 직접 가진 플레이어 번호
    private final Map<Long, List<Long>> partsOf = new ConcurrentHashMap<>();   // 합성 키워드 번호 → 구성 원본 번호
    private final Map<Long, Object> locks = new ConcurrentHashMap<>();
    private final Map<Long, long[]> byId = new ConcurrentHashMap<>(); // 행 번호 → {플레이어 번호, 키워드 번호}
    private record Key(long playerId, long keywordId) {}
    private final Set<Key> dirty = ConcurrentHashMap.newKeySet(); // 마지막 저장 뒤에 바뀐 행(추가·갱신·삭제)
    private volatile boolean tracking = true; // 시작할 때 DB에서 읽는 동안에는 바뀐 것으로 치지 않는다

    /** 마지막 저장 뒤에 바뀐 행 하나: holding이 null이면 지워진 것 */
    public record Change(long playerId, long keywordId, Holding holding) {}
    private final java.util.concurrent.atomic.AtomicLong idSeq = new java.util.concurrent.atomic.AtomicLong();

    /** 플레이어 한 명에 대한 여러 단계 작업을 직렬화하는 잠금 객체(synchronized에 쓴다) */
    public Object lock(long playerId) { return locks.computeIfAbsent(playerId, k -> new Object()); }

    /** 합성 키워드의 구성 원본을 알려 준다(카탈로그에서 읽은 값). 이미 있으면 덮어쓴다 */
    public void registerMerged(long mergedKeywordId, List<Long> partIds) { partsOf.put(mergedKeywordId, List.copyOf(partIds)); }

    /** 합성 키워드의 구성 원본이 이미 등록돼 있는지 */
    public boolean hasParts(long mergedKeywordId) { return partsOf.containsKey(mergedKeywordId); }

    public boolean isMerged(long keywordId) { return partsOf.containsKey(keywordId); }

    public List<Long> parts(long mergedKeywordId) { return partsOf.getOrDefault(mergedKeywordId, List.of()); }

    // ---------------------------------------------------------------- 쓰기

    /** 행을 넣거나(없으면) 시각을 갱신한다(있으면: 만료된 행 재사용 포함). 새로 생겼으면 true */
    public boolean upsert(long playerId, long keywordId, Instant createdAt, Instant expiresAt) { return upsert(0, playerId, keywordId, createdAt, expiresAt) != null; }

    /** 행을 넣거나 갱신한다. 새 행이면 번호를 정해(id가 0이면 새 번호, 아니면 그 번호) 돌려주고, 이미 있던 행이면 null을 돌려준다 */
    public Holding upsert(long id, long playerId, long keywordId, Instant createdAt, Instant expiresAt) {
        Map<Long, Holding> mine = byPlayer.computeIfAbsent(playerId, k -> new ConcurrentHashMap<>());
        Holding old = mine.get(keywordId);
        long rowId = old != null ? old.id() : (id != 0 ? id : idSeq.incrementAndGet());
        if (id > idSeq.get()) idSeq.accumulateAndGet(id, Math::max);
        Holding h = new Holding(rowId, keywordId, createdAt, expiresAt);
        mine.put(keywordId, h);
        if (tracking) dirty.add(new Key(playerId, keywordId));
        byId.put(rowId, new long[]{playerId, keywordId});
        holdersOf.computeIfAbsent(keywordId, k -> ConcurrentHashMap.newKeySet()).add(playerId);
        return old == null ? h : null;
    }

    /** 행을 지운다. 있었으면 true */
    public boolean remove(long playerId, long keywordId) {
        Map<Long, Holding> mine = byPlayer.get(playerId);
        Holding removed = mine == null ? null : mine.remove(keywordId);
        if (removed == null) return false;
        byId.remove(removed.id());
        if (tracking) dirty.add(new Key(playerId, keywordId));
        Set<Long> hs = holdersOf.get(keywordId);
        if (hs != null) hs.remove(playerId);
        return true;
    }

    /** 새 행 번호를 하나 정한다(트랜잭션 안에서 저장하기 전에 번호가 필요할 때) */
    public long newId() { return idSeq.incrementAndGet(); }

    /** 행 번호로 찾는다: {플레이어 번호, 키워드 번호}. 없으면 null */
    public long[] locate(long rowId) { return byId.get(rowId); }

    /** 모든 플레이어 번호(행이 있는) */
    public Collection<Long> playerIds() { return new ArrayList<>(byPlayer.keySet()); }

    /** 이 플레이어의 모든 행(만료된 것 포함) */
    public Collection<Holding> rowsOf(long playerId) {
        Map<Long, Holding> mine = byPlayer.get(playerId);
        return mine == null ? List.of() : new ArrayList<>(mine.values());
    }

    /** 이 키워드를 직접 가진 모든 플레이어 번호(만료된 행 포함) */
    public Collection<Long> holdersIncludingExpired(long keywordId) {
        Set<Long> hs = holdersOf.get(keywordId);
        return hs == null ? List.of() : new ArrayList<>(hs);
    }

    /** 만료 시각이 now 이하인 행을 모두 지우고 지운 행을 돌려준다(만료 정리) */
    public List<Row> removeExpired(Instant now) {
        List<Row> removed = new ArrayList<>();
        for (Map.Entry<Long, Map<Long, Holding>> p : byPlayer.entrySet()) {
            for (Holding h : new ArrayList<>(p.getValue().values())) {
                if (h.expired(now) && remove(p.getKey(), h.keywordId())) removed.add(new Row(h.id(), p.getKey(), h.keywordId(), h.createdAt(), h.expiresAt()));
            }
        }
        return removed;
    }

    // ---------------------------------------------------------------- 읽기

    /** 이 플레이어의 직접 가진 행(만료 전, 얻은 시각이 최근인 것부터) */
    public List<Holding> active(long playerId, Instant now) {
        Map<Long, Holding> mine = byPlayer.get(playerId);
        if (mine == null) return List.of();
        return mine.values().stream().filter(h -> !h.expired(now))
                .sorted((a, b) -> b.createdAt().compareTo(a.createdAt())).toList();
    }

    /** 이 키워드를 직접 가진 행(만료 여부 상관없이). 없으면 비어 있다 */
    public Optional<Holding> row(long playerId, long keywordId) {
        Map<Long, Holding> mine = byPlayer.get(playerId);
        return mine == null ? Optional.empty() : Optional.ofNullable(mine.get(keywordId));
    }

    /** 이 키워드를 가진 것으로 치는 행: 직접 가진 행, 없으면 그 키워드를 구성 원본으로 가진 합성 키워드의 행(만료 전만) */
    public Optional<Holding> covering(long playerId, long keywordId, Instant now) {
        Optional<Holding> direct = row(playerId, keywordId).filter(h -> !h.expired(now));
        if (direct.isPresent()) return direct;
        for (Holding h : active(playerId, now)) if (partsOf.getOrDefault(h.keywordId(), List.of()).contains(keywordId)) return Optional.of(h);
        return Optional.empty();
    }

    /** 가진 것으로 치는 키워드 번호: 직접 가진 행의 키워드와 합성 키워드의 구성 원본(만료 전) */
    public Set<Long> coveredIds(long playerId, Instant now) {
        Set<Long> out = new HashSet<>();
        for (Holding h : active(playerId, now)) {
            out.add(h.keywordId());
            out.addAll(partsOf.getOrDefault(h.keywordId(), List.of()));
        }
        return out;
    }

    /** 이 키워드를 직접 가진(만료 전) 플레이어 번호 */
    public List<Long> holderPlayerIds(long keywordId, Instant now) {
        Set<Long> hs = holdersOf.get(keywordId);
        if (hs == null) return List.of();
        List<Long> out = new ArrayList<>();
        for (long pid : hs) if (row(pid, keywordId).filter(h -> !h.expired(now)).isPresent()) out.add(pid);
        return out;
    }

    /** 보유 키워드 수: 합성 키워드는 구성 원본 수로 센다(4.44). starCount는 키워드 번호 → 성(일반은 1) */
    public int holdCount(long playerId, Instant now, ToIntFunction<Long> starCount) {
        int n = 0;
        for (Holding h : active(playerId, now)) n += Math.max(1, starCount.applyAsInt(h.keywordId()));
        return n;
    }

    // ---------------------------------------------------------------- 시작·종료

    /** 시작할 때 DB에서 읽은 행을 한꺼번에 넣는다 */
    public void load(Collection<Row> rows) {
        tracking = false;
        try { for (Row r : rows) upsert(r.id(), r.playerId(), r.keywordId(), r.createdAt(), r.expiresAt()); }
        finally { tracking = true; }
    }

    /** 마지막 저장 뒤에 바뀐 행을 현재 상태로 꺼내고 바뀐 표시를 지운다(저장하는 중에 또 바뀐 것은 다음 저장 때 나온다) */
    public List<Change> drainDirty() {
        List<Change> out = new ArrayList<>();
        for (Key k : new ArrayList<>(dirty)) {
            dirty.remove(k);
            out.add(new Change(k.playerId(), k.keywordId(), row(k.playerId(), k.keywordId()).orElse(null)));
        }
        return out;
    }

    /** 저장에 실패한 행을 다시 바뀐 것으로 되돌린다 */
    public void markDirty(Collection<Change> changes) { for (Change c : changes) dirty.add(new Key(c.playerId(), c.keywordId())); }

    /** 종료할 때 DB에 저장할 모든 행 */
    public List<Row> exportAll() {
        List<Row> out = new ArrayList<>();
        for (Map.Entry<Long, Map<Long, Holding>> p : byPlayer.entrySet())
            for (Holding h : p.getValue().values()) out.add(new Row(h.id(), p.getKey(), h.keywordId(), h.createdAt(), h.expiresAt()));
        return out;
    }

    public int size() { return byPlayer.values().stream().mapToInt(Map::size).sum(); }
}

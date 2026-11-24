package com.trendist.keyword.memory;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 키워드 카운터(가진 사람 수·추가 횟수·점수)를 서버 메모리에 두는 저장소(docs/plans/memory-holdings.md 4a). 켜져 있으면(INSTANCE가 있으면) {@code Keyword} 엔티티의
 * 세 값은 이 저장소가 원천이다: 읽기는 여기서, 쓰기는 여기에만 하고 DB에는 {@link KeywordCounterSync}가 바뀐 것만 1분마다·종료할 때 저장한다.
 * 그래서 구슬·합성·잃기마다 나가던 keywords UPDATE가 사라진다.
 *
 * 처음 만진 키워드는 엔티티가 DB에서 읽은 값으로 채운다(시작할 때 전부 읽지 않는다). 서비스는 실패하면 DB가 되돌려지는 것에 기대므로, 트랜잭션 안의 변화는
 * 그 트랜잭션의 저널에만 쌓고(같은 트랜잭션의 읽기는 겹쳐 본다) 커밋되면 반영하고 롤백되면 버린다. 사람 수·추가 횟수는 증감으로 반영해 동시에 커밋돼도 덮어쓰지 않는다.
 */
public final class KeywordCounters {
    /** 켜져 있을 때만 있다(꺼져 있으면 null: 엔티티가 지금까지처럼 자기 필드를 쓴다) */
    public static volatile KeywordCounters INSTANCE;

    private static final class Counters {
        long holder, add, trend;
        Counters(long holder, long add, long trend) { this.holder = holder; this.add = add; this.trend = trend; }
    }

    /** 한 트랜잭션의 변화: {사람 수 증감, 추가 증감, 점수를 새로 정했는지(0/1), 점수} */
    private final class Journal implements TransactionSynchronization {
        final Map<Long, long[]> pending = new HashMap<>();

        long[] of(long id) { return pending.computeIfAbsent(id, k -> new long[4]); }

        @Override
        public void afterCommit() {
            for (Map.Entry<Long, long[]> e : pending.entrySet()) {
                long[] p = e.getValue();
                Counters c = map.get(e.getKey());
                if (c == null) continue;
                synchronized (c) {
                    c.holder = Math.max(0, c.holder + p[0]);
                    c.add += p[1];
                    if (p[2] == 1) c.trend = p[3];
                }
                dirty.add(e.getKey());
            }
        }
    }

    private final Map<Long, Counters> map = new ConcurrentHashMap<>();
    private final Set<Long> dirty = ConcurrentHashMap.newKeySet();

    private Journal journal(boolean create) {
        if (!TransactionSynchronizationManager.isSynchronizationActive() || !TransactionSynchronizationManager.isActualTransactionActive()) return null;
        for (TransactionSynchronization s : TransactionSynchronizationManager.getSynchronizations()) if (s instanceof Journal j) return j;
        if (!create) return null;
        Journal j = new Journal();
        TransactionSynchronizationManager.registerSynchronization(j);
        return j;
    }

    private Counters base(long id, long dbHolder, long dbAdd, long dbTrend) {
        Counters c = map.get(id);
        return c != null ? c : map.computeIfAbsent(id, k -> new Counters(dbHolder, dbAdd, dbTrend));
    }

    // ---------------------------------------------------------------- 읽기(엔티티가 부른다. db*는 엔티티가 DB에서 읽은 값: 처음 만질 때 채우는 데만 쓴다)

    public long holder(long id, long dbHolder, long dbAdd, long dbTrend) {
        Counters c = base(id, dbHolder, dbAdd, dbTrend);
        long v;
        synchronized (c) { v = c.holder; }
        Journal j = journal(false);
        long[] p = j == null ? null : j.pending.get(id);
        return p == null ? v : Math.max(0, v + p[0]);
    }

    public long add(long id, long dbHolder, long dbAdd, long dbTrend) {
        Counters c = base(id, dbHolder, dbAdd, dbTrend);
        long v;
        synchronized (c) { v = c.add; }
        Journal j = journal(false);
        long[] p = j == null ? null : j.pending.get(id);
        return p == null ? v : v + p[1];
    }

    public long trend(long id, long dbHolder, long dbAdd, long dbTrend) {
        Counters c = base(id, dbHolder, dbAdd, dbTrend);
        long v;
        synchronized (c) { v = c.trend; }
        Journal j = journal(false);
        long[] p = j == null ? null : j.pending.get(id);
        return p != null && p[2] == 1 ? p[3] : v;
    }

    // ---------------------------------------------------------------- 쓰기

    public void addHolder(long id, long delta, long dbHolder, long dbAdd, long dbTrend) { change(id, delta, 0, false, 0, dbHolder, dbAdd, dbTrend); }
    public void addAdd(long id, long delta, long dbHolder, long dbAdd, long dbTrend) { change(id, 0, delta, false, 0, dbHolder, dbAdd, dbTrend); }
    public void setTrend(long id, long trend, long dbHolder, long dbAdd, long dbTrend) { change(id, 0, 0, true, trend, dbHolder, dbAdd, dbTrend); }

    private void change(long id, long dh, long da, boolean setTrend, long trend, long dbHolder, long dbAdd, long dbTrend) {
        Counters c = base(id, dbHolder, dbAdd, dbTrend);
        Journal j = journal(true);
        if (j != null) {
            long[] p = j.of(id);
            p[0] += dh; p[1] += da;
            if (setTrend) { p[2] = 1; p[3] = trend; }
            return;
        }
        synchronized (c) {
            c.holder = Math.max(0, c.holder + dh);
            c.add += da;
            if (setTrend) c.trend = trend;
        }
        dirty.add(id);
    }

    // ---------------------------------------------------------------- DB에 저장

    /** 바뀐 키워드의 현재 값 [번호, 사람 수, 추가 횟수, 점수]를 꺼내고 바뀐 표시를 지운다 */
    public List<long[]> drainDirty() {
        List<long[]> out = new ArrayList<>();
        for (Long id : new ArrayList<>(dirty)) {
            dirty.remove(id);
            Counters c = map.get(id);
            if (c == null) continue;
            synchronized (c) { out.add(new long[]{id, c.holder, c.add, c.trend}); }
        }
        return out;
    }

    /** 저장에 실패해 다시 시도해야 할 키워드를 바뀐 것으로 되돌린다 */
    public void markDirty(Collection<Long> ids) { dirty.addAll(ids); }

    public int size() { return map.size(); }
    public Set<Long> dirtyIds() { return Collections.unmodifiableSet(dirty); }
}

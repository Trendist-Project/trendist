package com.trendist.perf;

import com.sun.management.OperatingSystemMXBean;
import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import java.lang.management.ManagementFactory;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;
import javax.sql.DataSource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 성능 계측(로컬 점검용). 작업 이름마다 횟수·실행 시간·DB 대기 시간·SQL 수를 모아 10초마다 `[perf]` 로그로 요약하고,
 * 느린 작업은 바로 WARN으로 남긴다. 켜는 법: trendist.perf.enabled=true(application-dev.yml에서 켬, 운영은 꺼져 있다).
 * 꺼져 있으면 기록 호출은 바로 돌아온다. SQL 수는 {@link SqlCounter}가 켜져 있을 때만 의미가 있다.
 */
@Slf4j
@Component
public class PerfProbe {
    private static final class Stat {
        final LongAdder n = new LongAdder(), runNs = new LongAdder(), waitNs = new LongAdder(), sql = new LongAdder(), over = new LongAdder();
        final AtomicLong maxRun = new AtomicLong(), maxWait = new AtomicLong(), maxSql = new AtomicLong();
        final Map<String, LongAdder> kinds = new ConcurrentHashMap<>(); // SQL 종류별 누적 횟수(어떤 표를 몇 번 쳤나)
    }

    private static final class Val {
        final LongAdder n = new LongAdder(), sum = new LongAdder();
        final AtomicLong max = new AtomicLong();
    }

    private final boolean enabled;
    private final long slowNs;
    private final DataSource dataSource;
    private volatile Map<String, Stat> stats = new ConcurrentHashMap<>();
    private volatile Map<String, Val> vals = new ConcurrentHashMap<>();
    private final AtomicInteger dbQueued = new AtomicInteger(), dbRunning = new AtomicInteger();

    public PerfProbe(@Value("${trendist.perf.enabled:false}") boolean enabled, @Value("${trendist.perf.slow-ms:300}") long slowMs, DataSource dataSource) {
        this.enabled = enabled;
        this.slowNs = slowMs * 1_000_000L;
        this.dataSource = dataSource;
        if (enabled) log.info("[perf] 성능 계측 켜짐(느린 작업 기준 {}ms, 요약 10초마다)", slowMs);
    }

    public boolean enabled() { return enabled; }

    /** DB 작업 줄(RoomManager.db): 줄에 들어갔다 */
    public void dbEnqueued() { if (enabled) dbQueued.incrementAndGet(); }
    /** DB 작업 줄에서 나와 실행을 시작했다 */
    public void dbStarted() { if (enabled) { dbQueued.decrementAndGet(); dbRunning.incrementAndGet(); } }
    public void dbFinished() { if (enabled) dbRunning.decrementAndGet(); }

    /** 작업 하나를 기록한다. waitNs는 줄에서 기다린 시간, limitNs는 이 이상이면 "초과"로 세는 기준(0이면 느린 작업 기준) */
    public void record(String name, long waitNs, long runNs, int sql, long limitNs) {
        if (!enabled) return;
        Stat s = stats.computeIfAbsent(name, k -> new Stat());
        s.n.increment(); s.runNs.add(runNs); s.waitNs.add(waitNs); s.sql.add(sql);
        s.maxRun.accumulateAndGet(runNs, Math::max); s.maxWait.accumulateAndGet(waitNs, Math::max); s.maxSql.accumulateAndGet(sql, Math::max);
        long limit = limitNs > 0 ? limitNs : slowNs;
        if (runNs > limit) s.over.increment();
        if (runNs > slowNs && limitNs == 0 || waitNs > slowNs * 3) {
            log.warn("[perf] 느림 {} 실행 {}ms, 줄 대기 {}ms, SQL {}개 (DB 줄 대기 {} 실행 {})", name, runNs / 1_000_000, waitNs / 1_000_000, sql, dbQueued.get(), dbRunning.get());
        }
    }

    public void record(String name, long waitNs, long runNs, int sql) { record(name, waitNs, runNs, sql, 0); }

    /** SQL 종류별 횟수도 함께 기록한다(DB 줄 작업용: 무엇이 SQL을 많이 쓰는지 보려고) */
    public void record(String name, long waitNs, long runNs, int sql, Map<String, Integer> kinds) {
        record(name, waitNs, runNs, sql, 0);
        if (!enabled || kinds.isEmpty()) return;
        Stat s = stats.computeIfAbsent(name, k -> new Stat());
        kinds.forEach((k, v) -> s.kinds.computeIfAbsent(k, x -> new LongAdder()).add(v));
    }

    /** 작업을 실행하며 시간과 SQL 수를 기록한다(스케줄 작업·서비스 호출용). 꺼져 있으면 그냥 실행한다 */
    public void time(String name, Runnable task) {
        if (!enabled) { task.run(); return; }
        long t0 = System.nanoTime();
        int sql0 = SqlCounter.count();
        try { task.run(); } finally { record(name, 0, System.nanoTime() - t0, SqlCounter.count() - sql0); }
    }

    /** 숫자 하나를 기록한다(예: 한 번에 잃은 키워드 수) */
    public void value(String name, long v) {
        if (!enabled) return;
        Val x = vals.computeIfAbsent(name, k -> new Val());
        x.n.increment(); x.sum.add(v); x.max.accumulateAndGet(v, Math::max);
    }

    @Scheduled(fixedDelay = 10_000, initialDelay = 10_000)
    void report() {
        if (!enabled) return;
        Map<String, Stat> snap = stats; stats = new ConcurrentHashMap<>();
        Map<String, Val> vs = vals; vals = new ConcurrentHashMap<>();
        StringBuilder head = new StringBuilder("[perf] ");
        if (dataSource instanceof HikariDataSource h && h.getHikariPoolMXBean() != null) {
            HikariPoolMXBean p = h.getHikariPoolMXBean();
            head.append(String.format("연결풀 사용 %d/%d 유휴 %d 대기 %d | ", p.getActiveConnections(), p.getTotalConnections(), p.getIdleConnections(), p.getThreadsAwaitingConnection()));
        }
        head.append(String.format("DB 줄 대기 %d 실행 %d", dbQueued.get(), dbRunning.get()));
        try {
            OperatingSystemMXBean os = (OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean();
            Runtime rt = Runtime.getRuntime();
            head.append(String.format(" | CPU 프로세스 %.0f%% 힙 %dMB/%dMB 스레드 %d", os.getProcessCpuLoad() * 100, (rt.totalMemory() - rt.freeMemory()) >> 20, rt.maxMemory() >> 20,
                    Thread.activeCount()));
        } catch (RuntimeException | LinkageError ignored) { /* 일부 환경에서는 CPU 값을 못 읽는다 */ }
        log.info(head.toString());
        List<Map.Entry<String, Stat>> rows = new ArrayList<>(snap.entrySet());
        rows.sort(Comparator.comparingLong((Map.Entry<String, Stat> e) -> e.getValue().runNs.sum()).reversed());
        for (Map.Entry<String, Stat> e : rows) {
            Stat s = e.getValue();
            long n = Math.max(1, s.n.sum());
            log.info(String.format("[perf] %-28s 횟수 %5d | 실행 평균 %6.1fms 최대 %6dms 초과 %d | 줄 대기 평균 %6.1fms 최대 %6dms | SQL 평균 %6.1f 최대 %d",
                    e.getKey(), s.n.sum(), s.runNs.sum() / 1e6 / n, s.maxRun.get() / 1_000_000, s.over.sum(), s.waitNs.sum() / 1e6 / n, s.maxWait.get() / 1_000_000,
                    (double) s.sql.sum() / n, s.maxSql.get()));
            if (!s.kinds.isEmpty() && s.sql.sum() / n >= 6) {
                String top = s.kinds.entrySet().stream().sorted((a, b) -> Long.compare(b.getValue().sum(), a.getValue().sum())).limit(8)
                        .map(k -> String.format("%s ×%.1f", k.getKey(), (double) k.getValue().sum() / n)).collect(java.util.stream.Collectors.joining(", "));
                log.info("[perf]   ↳ 작업 1번당 SQL: " + top);
            }
        }
        vs.forEach((k, v) -> log.info(String.format("[perf] %-28s 횟수 %5d | 평균 %.1f 최대 %d 합 %d", k, v.n.sum(), (double) v.sum.sum() / Math.max(1, v.n.sum()), v.max.get(), v.sum.sum())));
    }
}

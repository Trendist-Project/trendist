package com.trendist.keyword.memory;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 메모리의 키워드 카운터({@link KeywordCounters})를 켜고(`trendist.memory-counters=true`) DB와 맞춘다: 바뀐 것만 1분마다, 정상 종료할 때 한 번 더 저장한다.
 * 저장은 한 문장에 최대 100개씩 묶어서 보낸다. 실패하면 바뀐 표시를 되돌려 다음에 다시 시도한다.
 */
@Component
@ConditionalOnProperty(name = "trendist.memory-counters", havingValue = "true")
@RequiredArgsConstructor
public class KeywordCounterSync {
    private static final Logger log = LoggerFactory.getLogger(KeywordCounterSync.class);
    private static final int CHUNK = 100;

    private final JdbcTemplate jdbc;

    @PostConstruct
    void enable() {
        KeywordCounters.INSTANCE = new KeywordCounters();
        log.info("memory counters: enabled (DB sync every 60s and on shutdown)");
    }

    @Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    public void flush() {
        KeywordCounters c = KeywordCounters.INSTANCE;
        if (c == null) return;
        List<long[]> dirty = c.drainDirty();
        if (dirty.isEmpty()) return;
        List<Long> failed = new ArrayList<>();
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC); // Hibernate와 같게 UTC 벽시계 값으로 쓴다(hibernate.jdbc.time_zone=UTC)
        for (int i = 0; i < dirty.size(); i += CHUNK) {
            List<long[]> part = dirty.subList(i, Math.min(dirty.size(), i + CHUNK));
            try {
                StringBuilder sql = new StringBuilder("update keywords set holder_count = case id");
                List<Object> args = new ArrayList<>();
                for (long[] r : part) { sql.append(" when ? then ?"); args.add(r[0]); args.add(r[1]); }
                sql.append(" end, add_count = case id");
                for (long[] r : part) { sql.append(" when ? then ?"); args.add(r[0]); args.add(r[2]); }
                sql.append(" end, trend_value = case id");
                for (long[] r : part) { sql.append(" when ? then ?"); args.add(r[0]); args.add(r[3]); }
                sql.append(" end, updated_at = ? where id in (").append(String.join(",", Collections.nCopies(part.size(), "?"))).append(")");
                args.add(now);
                for (long[] r : part) args.add(r[0]);
                jdbc.update(sql.toString(), args.toArray());
            } catch (RuntimeException e) {
                log.warn("memory counters: sync of {} keywords failed; will retry", part.size(), e);
                for (long[] r : part) failed.add(r[0]);
            }
        }
        if (!failed.isEmpty()) c.markDirty(failed);
        else log.debug("memory counters: synced {} keywords", dirty.size());
    }

    @PreDestroy
    void flushOnShutdown() {
        flush();
        KeywordCounters.INSTANCE = null;
    }
}

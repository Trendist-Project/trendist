package com.trendist.player.memory;

import jakarta.annotation.PreDestroy;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import com.trendist.player.service.PlayerService;

/**
 * {@link PlayerCounterBuffer}에 모인 킬·빼앗기 기록을 1분마다, 그리고 정상 종료할 때 DB에 반영한다.
 * 플레이어 한 명당 트랜잭션 하나(행 잠금 하나, 점수 재합산 하나)로 처리한다. 실패한 플레이어는 버퍼에 되돌려 다음 주기에 다시 한다.
 */
@Component
@RequiredArgsConstructor
public class PlayerCounterFlusher {
    private static final Logger log = LoggerFactory.getLogger(PlayerCounterFlusher.class);

    private final PlayerCounterBuffer buffer;
    private final PlayerService players;

    @Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    public void flush() {
        Map<Long, long[]> drained = buffer.drain();
        if (drained.isEmpty()) return;
        int ok = 0;
        for (Map.Entry<Long, long[]> e : drained.entrySet()) {
            long[] a = e.getValue();
            try {
                players.applyBufferedCounters(e.getKey(), PlayerCounterBuffer.kills(a), PlayerCounterBuffer.steals(a), PlayerCounterBuffer.exp(a));
                ok++;
            } catch (RuntimeException ex) {
                log.warn("player counters: flush failed for player {}; will retry", e.getKey(), ex);
                buffer.restore(e.getKey(), a);
            }
        }
        log.info("player counters: flushed {} players", ok);
    }

    @PreDestroy
    public void flushOnShutdown() {
        log.info("player counters: shutdown flush");
        flush();
    }
}

package com.trendist.player.memory;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

class PlayerCounterBufferTest {

    /** 스프링 없이 만든다(쌓기·꺼내기·되돌리기 동작만 검사한다. enabled 플래그는 여기서 쓰지 않는다) */
    private static PlayerCounterBuffer buffer() {
        return new PlayerCounterBuffer();
    }

    @Test
    void killsAndStealsAccumulatePerPlayerAndExpIsSummed() {
        PlayerCounterBuffer b = buffer();
        b.addKill(1L, 5);
        b.addKill(1L, 5);
        b.addSteal(1L, 3);
        b.addKill(2L, 7);

        Map<Long, long[]> out = b.drain();
        assertThat(out).hasSize(2);
        long[] p1 = out.get(1L);
        assertThat(PlayerCounterBuffer.kills(p1)).isEqualTo(2);
        assertThat(PlayerCounterBuffer.steals(p1)).isEqualTo(1);
        assertThat(PlayerCounterBuffer.exp(p1)).isEqualTo(13);
        assertThat(PlayerCounterBuffer.kills(out.get(2L))).isEqualTo(1);
    }

    @Test
    void drainEmptiesTheBuffer() {
        PlayerCounterBuffer b = buffer();
        b.addKill(1L, 5);
        assertThat(b.drain()).hasSize(1);
        assertThat(b.drain()).isEmpty();
    }

    @Test
    void valuesAddedAfterDrainGoToTheNextFlush() {
        PlayerCounterBuffer b = buffer();
        b.addKill(1L, 5);
        b.drain();
        b.addKill(1L, 5);
        long[] next = b.drain().get(1L);
        assertThat(PlayerCounterBuffer.kills(next)).isEqualTo(1);
    }

    @Test
    void restoreAddsBackAFailedFlushForTheNextAttempt() {
        PlayerCounterBuffer b = buffer();
        b.addKill(1L, 5);
        long[] failed = b.drain().get(1L);
        b.addKill(1L, 5); // 실패 사이에 들어온 값
        b.restore(1L, failed);

        long[] retry = b.drain().get(1L);
        assertThat(PlayerCounterBuffer.kills(retry)).isEqualTo(2);
        assertThat(PlayerCounterBuffer.exp(retry)).isEqualTo(10);
    }

    @Test
    void concurrentAddsFromManyThreadsAreNotLost() throws Exception {
        PlayerCounterBuffer b = buffer();
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            Future<?>[] fs = IntStream.range(0, 8).mapToObj(t -> pool.submit(() -> {
                for (int i = 0; i < 10_000; i++) b.addKill(1L + (i % 3), 1);
            })).toArray(Future[]::new);
            for (Future<?> f : fs) f.get();
        } finally {
            pool.shutdown();
        }
        long kills = b.drain().values().stream().mapToLong(PlayerCounterBuffer::kills).sum();
        assertThat(kills).isEqualTo(80_000);
    }
}

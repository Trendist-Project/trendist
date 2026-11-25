package com.trendist.keyword.worker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.trendist.common.exception.ApiException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

class KeywordWorkersTest {

    @Test
    void sameKeyRunsOnOneWorkerInOrder() throws Exception {
        KeywordWorkers w = new KeywordWorkers(4);
        List<String> threads = new ArrayList<>();
        List<Integer> order = new ArrayList<>(); // 같은 워커에서만 건드리므로 동기화하지 않는다(그것 자체가 검증 대상)
        for (int i = 0; i < 50; i++) {
            final int n = i;
            w.call(7L, () -> { threads.add(Thread.currentThread().getName()); order.add(n); return n; }, Duration.ofSeconds(5));
        }
        assertThat(threads).hasSize(50).containsOnly(threads.get(0));
        assertThat(order).containsExactlyElementsOf(java.util.stream.IntStream.range(0, 50).boxed().toList());
    }

    @Test
    void unsynchronizedIncrementsOnOneKeyAreNotLost() throws Exception {
        KeywordWorkers w = new KeywordWorkers(4);
        ExecutorService pool = Executors.newFixedThreadPool(8);
        int[] counter = {0};
        try {
            List<Future<?>> fs = new ArrayList<>();
            for (int t = 0; t < 8; t++) {
                fs.add(pool.submit(() -> {
                    for (int i = 0; i < 1_000; i++) w.call(42L, () -> { counter[0]++; return null; }, Duration.ofSeconds(5));
                }));
            }
            for (Future<?> f : fs) f.get();
        } finally {
            pool.shutdown();
        }
        assertThat(counter[0]).isEqualTo(8_000);
    }

    @Test
    void taskExceptionIsRethrownAsItWas() {
        KeywordWorkers w = new KeywordWorkers(2);
        assertThatThrownBy(() -> w.call(1L, () -> { throw new IllegalArgumentException("boom"); }, Duration.ofSeconds(5)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("boom");
    }

    @Test
    void waitingLongerThanTheLimitGivesKeywordBusy() throws Exception {
        KeywordWorkers w = new KeywordWorkers(1);
        CountDownLatch hold = new CountDownLatch(1);
        CountDownLatch started = new CountDownLatch(1);
        ExecutorService caller = Executors.newSingleThreadExecutor();
        Future<?> blocker = caller.submit(() -> w.call(5L, () -> { started.countDown(); hold.await(); return null; }, Duration.ofSeconds(10)));
        try {
            started.await(); // 차단 작업이 워커에서 실제로 돌고 있을 때 뒤의 작업을 넣는다
            assertThatThrownBy(() -> w.call(5L, () -> "late", Duration.ofMillis(200)))
                    .isInstanceOf(ApiException.class)
                    .satisfies(e -> assertThat(((ApiException) e).code()).isEqualTo("KEYWORD_BUSY"));
        } finally {
            hold.countDown();
            blocker.get();
            caller.shutdown();
        }
    }
}

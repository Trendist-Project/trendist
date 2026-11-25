package com.trendist.keyword.worker;

import com.trendist.common.exception.ApiException;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 키워드 워커(docs/plans/keyword-worker.md, 2a). 작업의 열쇠(key)가 같으면 항상 같은 워커 스레드에서 차례로 실행되므로,
 * 같은 키워드를 바꾸는 요청끼리는 DB 행 락 없이도 서로 기다리며 순서대로 처리된다.
 * 워커 수는 {@code trendist.keyword-workers}(0이면 CPU 코어 수, 최소 2).
 */
@Component
public class KeywordWorkers {
    private final ExecutorService[] lanes;

    public KeywordWorkers(@Value("${trendist.keyword-workers:0}") int configured) {
        int n = configured > 0 ? configured : Math.max(2, Runtime.getRuntime().availableProcessors());
        lanes = new ExecutorService[n];
        for (int i = 0; i < n; i++) {
            int id = i + 1;
            lanes[i] = Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "keyword-worker-" + id);
                t.setDaemon(true);
                return t;
            });
        }
    }

    public int lanes() { return lanes.length; }

    /**
     * key의 워커에서 task를 실행하고 결과를 기다린다. wait 안에 끝나지 않으면 KEYWORD_BUSY를 던지고,
     * 아직 시작하지 않은 작업은 취소한다(이미 시작했으면 끝까지 실행된다: 클라이언트는 다시 시도할 수 있다).
     * task가 던진 예외는 그대로 다시 던진다.
     */
    public <T> T call(long key, Callable<T> task, Duration wait) {
        Future<T> f = lanes[(int) Math.floorMod(key, (long) lanes.length)].submit(task);
        try {
            return f.get(wait.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            f.cancel(false);
            throw busy();
        } catch (ExecutionException e) {
            Throwable c = e.getCause();
            if (c instanceof RuntimeException re) throw re;
            if (c instanceof Error err) throw err;
            throw new IllegalStateException(c);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            f.cancel(false);
            throw busy();
        }
    }

    private static ApiException busy() {
        return ApiException.tooMany("KEYWORD_BUSY", "잠시 후 다시 시도해 주세요");
    }

    @PreDestroy
    public void shutdown() {
        for (ExecutorService ex : lanes) ex.shutdownNow();
    }
}

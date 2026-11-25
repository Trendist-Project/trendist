package com.trendist.player.memory;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 킬·빼앗기 기록을 메모리에 모아 두는 버퍼(`trendist.memory-player-counters=true`일 때만 쓴다).
 * 플레이어마다 {킬 수, 빼앗기 수, 더할 EXP}를 쌓고, {@link PlayerCounterFlusher}가 1분마다 꺼내 DB에 한 번에 반영한다.
 * 플레이어별 갱신은 {@link ConcurrentHashMap#compute}로 원자적으로 하므로 방들 사이에 전역 락이 생기지 않는다.
 * 서버가 강제 종료되면 마지막 1분 치가 사라진다(키워드 카운터와 같은 정책).
 */
@Component
public class PlayerCounterBuffer {
    private static final int KILLS = 0, STEALS = 1, EXP = 2;

    @Value("${trendist.memory-player-counters:false}")
    private boolean enabled;

    /** 플레이어 번호 → {킬 수, 빼앗기 수, EXP}. 값 배열은 compute 안에서만 고친다 */
    private final Map<Long, long[]> pending = new ConcurrentHashMap<>();

    public boolean enabled() { return enabled; }

    public void addKill(long playerId, long exp) {
        pending.compute(playerId, (k, v) -> {
            long[] a = v != null ? v : new long[3];
            a[KILLS]++;
            a[EXP] += exp;
            return a;
        });
    }

    public void addSteal(long playerId, long exp) {
        pending.compute(playerId, (k, v) -> {
            long[] a = v != null ? v : new long[3];
            a[STEALS]++;
            a[EXP] += exp;
            return a;
        });
    }

    /** 지금까지 모은 값을 꺼내고 버퍼를 비운다. 꺼낸 뒤 들어온 값은 새 항목에 쌓인다. */
    public Map<Long, long[]> drain() {
        Map<Long, long[]> out = new HashMap<>();
        for (Long id : pending.keySet()) {
            long[] a = pending.remove(id);
            if (a != null) out.put(id, a);
        }
        return out;
    }

    /** 저장에 실패한 값을 다시 넣는다(다음 주기에 재시도) */
    public void restore(long playerId, long[] a) {
        pending.merge(playerId, a, (x, y) -> {
            x[KILLS] += y[KILLS];
            x[STEALS] += y[STEALS];
            x[EXP] += y[EXP];
            return x;
        });
    }

    public static long kills(long[] a) { return a[KILLS]; }
    public static long steals(long[] a) { return a[STEALS]; }
    public static long exp(long[] a) { return a[EXP]; }
}

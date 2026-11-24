package com.trendist.perf;

import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.hibernate.resource.jdbc.spi.StatementInspector;

/**
 * 스레드마다 실행한 SQL 문장 수와 종류(예: "select player_keywords")를 센다(성능 계측용). Hibernate가 SQL을 만들 때마다 부르므로
 * {@link PerfProbe}가 작업 앞뒤의 차이로 "이 작업이 DB를 몇 번, 어떤 표에 쳤나"를 잰다.
 * 로컬(application-dev.yml)에서만 켠다: spring.jpa.properties.hibernate.session_factory.statement_inspector.
 */
public class SqlCounter implements StatementInspector {
    private static final ThreadLocal<int[]> COUNT = ThreadLocal.withInitial(() -> new int[1]);
    private static final ThreadLocal<Map<String, int[]>> KINDS = ThreadLocal.withInitial(HashMap::new);
    private static final Pattern KIND = Pattern.compile("(?is)^\\s*(select|update|insert|delete)\\b(?:.*?\\b(?:from|into)\\s+|\\s+)(\\w+)");

    @Override
    public String inspect(String sql) {
        COUNT.get()[0]++;
        Matcher m = KIND.matcher(sql);
        KINDS.get().computeIfAbsent(m.find() ? m.group(1).toLowerCase() + " " + m.group(2) : "기타", k -> new int[1])[0]++;
        return sql;
    }

    /** 이 스레드가 지금까지 실행한 SQL 수 */
    public static int count() { return COUNT.get()[0]; }

    /** 이 스레드가 모은 SQL 종류별 횟수를 꺼내고 비운다(작업이 끝날 때 한 번 부른다) */
    public static Map<String, Integer> takeKinds() {
        Map<String, Integer> out = new HashMap<>();
        KINDS.get().forEach((k, v) -> out.put(k, v[0]));
        KINDS.get().clear();
        return out;
    }

    /** 작업을 시작하기 전에 불러 이전 작업의 찌꺼기를 비운다 */
    public static void clearKinds() { KINDS.get().clear(); }
}

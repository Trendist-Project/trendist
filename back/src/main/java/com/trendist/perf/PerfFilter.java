package com.trendist.perf;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** HTTP 요청마다 걸린 시간과 SQL 수를 기록한다(계측을 켰을 때만). 경로의 숫자는 {n}으로 묶어 같은 종류끼리 모은다. */
@Component
@ConditionalOnProperty(name = "trendist.perf.enabled", havingValue = "true")
public class PerfFilter extends OncePerRequestFilter {
    private final PerfProbe perf;

    public PerfFilter(PerfProbe perf) { this.perf = perf; }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        long t0 = System.nanoTime();
        int sql0 = SqlCounter.count();
        try {
            chain.doFilter(req, res);
        } finally {
            perf.record("http " + req.getMethod() + " " + req.getRequestURI().replaceAll("\\d+", "{n}"), 0, System.nanoTime() - t0, SqlCounter.count() - sql0);
        }
    }
}

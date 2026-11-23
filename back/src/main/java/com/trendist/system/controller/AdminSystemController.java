package com.trendist.system.controller;

import java.lang.management.ManagementFactory;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 관리자 대시보드의 서버 상태(가동 시간). /api/admin/**는 ROLE_ADMIN만 들어온다. */
@RestController
@RequestMapping("/api/admin/system")
public class AdminSystemController {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    /** 서버가 시작한 시각(프로세스 시작 기준)과 지금까지 흐른 시간. 화면은 uptimeMillis 에서 이어서 초 단위로 센다 */
    public record ServerInfo(OffsetDateTime startedAt, long uptimeMillis) {}

    @GetMapping
    public ServerInfo info() {
        var runtime = ManagementFactory.getRuntimeMXBean();
        return new ServerInfo(Instant.ofEpochMilli(runtime.getStartTime()).atZone(SEOUL).toOffsetDateTime(), runtime.getUptime());
    }
}

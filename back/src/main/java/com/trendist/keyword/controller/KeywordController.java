package com.trendist.keyword.controller;

import com.trendist.auth.security.AuthUser;
import com.trendist.keyword.dto.KeywordDtos;
import com.trendist.keyword.service.AiCommentService;
import com.trendist.keyword.service.KeywordActivityService;
import com.trendist.keyword.service.KeywordService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class KeywordController {
    private final KeywordService service;
    private final KeywordActivityService activityService;
    private final AiCommentService aiComments;
    private final com.trendist.keyword.service.KeywordGradeService gradeService;

    @GetMapping("/keywords/search")
    public KeywordDtos.SearchResult search(@AuthenticationPrincipal AuthUser user, @RequestParam String q) {
        return service.search(user.userId(), q);
    }

    @PostMapping("/keywords/plus")
    public KeywordDtos.PlusResult plus(@AuthenticationPrincipal AuthUser user, @Valid @RequestBody KeywordDtos.PlusRequest req) {
        return service.plus(user.userId(), req.text());
    }

    /** 보관함 카드 등급 기준(4.42). */
    @GetMapping("/keywords/grades")
    public KeywordDtos.GradeInfo grades() { return gradeService.grades(); }

    @GetMapping("/keywords/{id}")
    public KeywordDtos.KeywordCard detail(@AuthenticationPrincipal AuthUser user, @PathVariable long id, HttpServletRequest req) {
        return service.detail(user.userId(), id, req.getRemoteAddr(), req.getHeader(HttpHeaders.USER_AGENT));
    }

    /** 활동 그래프(4.12, 9.9). range: 24h / 7d / 30d / 180d. */
    @GetMapping("/keywords/{id}/activity")
    public KeywordDtos.Activity activity(@AuthenticationPrincipal AuthUser user, @PathVariable long id,
                                         @RequestParam(defaultValue = "24h") String range) {
        return activityService.activity(user.userId(), id, range);
    }

    /** AI 한 줄 설명이 맞지 않다는 갱신 요청(4.12). 관리자가 먼저 접수받고 AI에게 다시 받거나 직접 고친다. */
    @PostMapping("/keywords/{id}/ai-comment/request")
    public void requestAiComment(@AuthenticationPrincipal AuthUser user, @PathVariable long id) {
        aiComments.request(user.userId(), id);
    }

    /** 합성 미리보기·합성·합성 키워드 상세(4.44). */
    @GetMapping("/me/keywords/merge-preview")
    public KeywordDtos.MergePreview mergePreview(@AuthenticationPrincipal AuthUser user, @RequestParam long a, @RequestParam long b) {
        return service.mergePreview(user.userId(), a, b);
    }

    @PostMapping("/me/keywords/merge")
    public KeywordDtos.MergeResult merge(@AuthenticationPrincipal AuthUser user, @Valid @RequestBody KeywordDtos.MergeRequest req) {
        return service.merge(user.userId(), req.first(), req.second());
    }

    @GetMapping("/keywords/merged/{id}")
    public KeywordDtos.MergedDetail mergedDetail(@AuthenticationPrincipal AuthUser user, @PathVariable long id) {
        return service.mergedDetail(user.userId(), id);
    }

    @GetMapping("/keywords/merged/{id}/activity")
    public KeywordDtos.Activity mergedActivity(@AuthenticationPrincipal AuthUser user, @PathVariable long id,
                                               @RequestParam(defaultValue = "24h") String range) {
        return activityService.mergedActivity(user.userId(), id, range);
    }

    @GetMapping("/me/keywords")
    public List<KeywordDtos.MyKeyword> myKeywords(@AuthenticationPrincipal AuthUser user) {
        return service.myKeywords(user.userId());
    }
}

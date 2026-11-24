package com.trendist.keyword.service;

import com.trendist.keyword.dto.KeywordDtos;
import com.trendist.keyword.entity.DataSource;
import com.trendist.keyword.repository.DataSourceRepository;
import com.trendist.keyword.support.MergeKey;
import com.trendist.setting.service.SettingService;
import com.trendist.setting.support.SettingKeys;
import java.math.BigDecimal;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 보관함 카드의 등급 기준(4.42). 노멀 등급의 끝은 **일반(1성) 키워드가 한 개로 낼 수 있는 가장 높은 점수**, 곧
 * 최대 기준값 × 가장 큰 소스 가중치 + 최대 글자 수 × 글자 가점이다(기본 50 × 1 + 20 × 1 = 70). 그 위의 등급은 이 값의 배수다.
 * 설정(13.3)을 바꾸면 기준도 따라간다.
 */
@Service
@RequiredArgsConstructor
public class KeywordGradeService {
    /** 레어 이상의 최소 점수 배수(노멀의 끝 = 1배 초과, 에픽 2배, 유니크 4배, 레전드리 8배, 신화 16배). */
    private static final int[] MULTIPLES = {2, 4, 8, 16};

    private final SettingService settings;
    private final DataSourceRepository dataSources;

    @Transactional(readOnly = true)
    public KeywordDtos.GradeInfo grades() {
        BigDecimal maxWeight = BigDecimal.ONE;
        for (DataSource s : dataSources.findAll()) if (s.getWeight().compareTo(maxWeight) > 0) maxWeight = s.getWeight();
        long single = Math.round(settings.getDouble(SettingKeys.TREND_MAX_BASE) * maxWeight.doubleValue())
                + Math.round(MergeKey.MAX_TEXT_LENGTH * settings.getDouble(SettingKeys.KEYWORD_LENGTH_BONUS_PER_CHAR));
        long base = Math.max(1, single);
        long[] mins = new long[MULTIPLES.length + 1];
        mins[0] = base + 1; // 레어: 일반 키워드의 한계를 넘는 점수
        for (int i = 0; i < MULTIPLES.length; i++) mins[i + 1] = base * MULTIPLES[i];
        return new KeywordDtos.GradeInfo(base, java.util.Arrays.stream(mins).boxed().toList());
    }
}

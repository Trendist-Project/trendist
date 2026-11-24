package com.trendist.keyword.support;

import com.trendist.setting.service.SettingService;
import com.trendist.setting.support.SettingKeys;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 4.8의 식.
 * x = min(1, (n / max(P, 최소 인원)) / 최고점 비율)     // n = 가진 사람 수, P = 그 나라 활동 인원
 * g = log10(1 + x/c) / log10(1 + 1/c)
 * trend_value = 활성이면 w × (base + (max − base) × g), 아니면 0
 * 키워드 점수 = trend_value(트렌드 값이 곧 내 유행도에 더해지는 점수). 정수로 반올림한다(0.5는 올림).
 * 개정(4.44): 🔥활성이면 공백을 뺀 글자 수 × keyword_length_bonus_per_char를 더하고, 점수에 상한(예전의 100)을 두지 않는다.
 * 합성 키워드의 점수는 구성 원본(1성) 점수의 합 × 별 개수(구성 원본 수)다({@link #mergedValue}).
 */
@Component
@RequiredArgsConstructor
public class TrendFormula {
    private final SettingService settings;

    public long trendValue(boolean active, long holders, double weight, long population) {
        return trendValue(active, holders, weight, population, 0);
    }

    /** normalizedLength: 정규화 값(공백 제거)의 글자 수. 글자 수 가점(4.44)에 쓴다. */
    public long trendValue(boolean active, long holders, double weight, long population, int normalizedLength) {
        if (!active) return 0;
        double pop = Math.max(population, settings.getDouble(SettingKeys.TREND_MIN_POPULATION));
        double c = settings.getDouble(SettingKeys.TREND_LOG_SOFTNESS);
        double base = settings.getDouble(SettingKeys.TREND_BASE_RATIO);
        double max = settings.getDouble(SettingKeys.TREND_MAX_BASE);
        double x = Math.min(1, holders / pop / settings.getDouble(SettingKeys.TREND_FULL_SHARE));
        double g = Math.log10(1 + x / c) / Math.log10(1 + 1 / c);
        double v = Math.max(0, weight * (base + (max - base) * g));
        long bonus = Math.round(Math.max(0, normalizedLength) * settings.getDouble(SettingKeys.KEYWORD_LENGTH_BONUS_PER_CHAR));
        return Math.round(v) + bonus; // 상한 없음(4.44)
    }

    /** 합성 점수(4.44): 구성 원본(1성) 키워드 점수의 합 × 별 개수. */
    public long mergedValue(long partSum, int stars) {
        return Math.max(0, partSum) * Math.max(1, stars);
    }

    /**
     * +1성 보너스 확률(%, 4.44): 합성 결과의 성(보너스 전)이 높을수록 낮다. base × (decay/100)^(성 − 2). 2성 미만은 base.
     */
    public double mergeBonusPercent(int stars) {
        double base = settings.getDouble(SettingKeys.MERGE_BONUS_BASE_PERCENT);
        double decay = settings.getDouble(SettingKeys.MERGE_BONUS_DECAY_PERCENT) / 100.0;
        return Math.min(100, Math.max(0, base * Math.pow(decay, Math.max(0, stars - 2))));
    }

    public long expScore(long exp) { return Math.min(exp, settings.getInt(SettingKeys.EXP_SCORE_CAP)); }
}

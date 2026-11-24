package com.trendist.arena;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.trendist.arena.support.Weather;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import com.trendist.setting.service.SettingService;

/** 아레나 배경 테마·날씨(4.38): 로그인 없이 읽고, 날씨는 설정 방식대로 정해지며, 외부 날씨 코드를 아레나 날씨로 바꾼다 */
@SpringBootTest
@ActiveProfiles("test")
@AutoConfigureMockMvc
class ArenaThemeTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired SettingService settings;

    private void set(String name, String value) {
        jdbc.update("update settings set value = ? where name = ?", value, name);
        settings.invalidate();
    }

    @AfterEach
    void reset() {
        set("arena_bg", "0"); set("arena_light_mode", "0"); set("arena_light_fixed", "1"); set("arena_weather_mode", "0"); set("arena_weather_fixed", "0");
    }

    @Test
    void wmoCodesMapToArenaWeather() {
        assertThat(Weather.fromWmo(0)).isEqualTo(Weather.CLEAR);
        assertThat(Weather.fromWmo(1)).isEqualTo(Weather.CLEAR);
        assertThat(Weather.fromWmo(3)).isEqualTo(Weather.CLOUDY);
        assertThat(Weather.fromWmo(45)).isEqualTo(Weather.FOG);
        assertThat(Weather.fromWmo(61)).isEqualTo(Weather.RAIN);
        assertThat(Weather.fromWmo(81)).isEqualTo(Weather.RAIN);
        assertThat(Weather.fromWmo(73)).isEqualTo(Weather.SNOW);
        assertThat(Weather.fromWmo(86)).isEqualTo(Weather.SNOW);
        assertThat(Weather.fromWmo(95)).isEqualTo(Weather.STORM);
        assertThat(Weather.fromWmo(99)).isEqualTo(Weather.STORM);
        assertThat(Weather.fromWmo(1234)).isEqualTo(Weather.CLOUDY);
    }

    @Test
    void defaultIsTheOriginalBackgroundWithoutWeather() throws Exception {
        mvc.perform(get("/api/arena-theme")).andExpect(status().isOk())
                .andExpect(jsonPath("$.bg").value(0)).andExpect(jsonPath("$.lightMode").value(0)).andExpect(jsonPath("$.lightFixed").value(1)).andExpect(jsonPath("$.weatherMode").value(0)).andExpect(jsonPath("$.weather").value(0))
                .andExpect(jsonPath("$.lat").value(37.5665)).andExpect(jsonPath("$.nowMs").isNumber());
    }

    @Test
    void fixedModesAreReturnedAndGlobalUsesItsOwnPlace() throws Exception {
        set("arena_bg", "21"); set("arena_light_mode", "2"); set("arena_light_fixed", "3"); set("arena_weather_mode", "2"); set("arena_weather_fixed", "3");
        mvc.perform(get("/api/arena-theme").param("country", "GLOBAL")).andExpect(status().isOk())
                .andExpect(jsonPath("$.bg").value(21)).andExpect(jsonPath("$.lightMode").value(2)).andExpect(jsonPath("$.lightFixed").value(3))
                .andExpect(jsonPath("$.weather").value(3)).andExpect(jsonPath("$.lat").value(51.5)).andExpect(jsonPath("$.lon").value(0.0));
        mvc.perform(get("/api/arena-theme").param("country", "nowhere")).andExpect(jsonPath("$.lat").value(37.5665)); // 모르는 나라는 KR
    }

    @Test
    void outOfRangeValuesAreClamped() throws Exception {
        jdbc.update("update settings set value = ? where name = ?", "40", "arena_bg"); settings.invalidate();
        mvc.perform(get("/api/arena-theme")).andExpect(jsonPath("$.bg").value(40)).andExpect(jsonPath("$.lightFixed").value(1));
    }

    @Test
    void realWeatherWithoutASourceResultIsClear() throws Exception {
        set("arena_weather_mode", "1"); // 테스트 프로필은 외부 날씨를 읽지 않는다 → 맑음
        mvc.perform(get("/api/arena-theme")).andExpect(jsonPath("$.weatherMode").value(1)).andExpect(jsonPath("$.weather").value(0));
    }
}

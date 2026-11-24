package com.trendist.uisetting;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/** 계정별 게임 화면 설정(4.45): 저장한 적이 없으면 기본값(saved=false), 저장하면 그대로 돌려주고, 범위를 넘으면 거절하며, 계정마다 따로다 */
@SpringBootTest
@ActiveProfiles("test")
@AutoConfigureMockMvc
class UiSettingApiTest {
    @Autowired MockMvc mvc;

    private String guest() throws Exception {
        MvcResult r = mvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        return JsonPath.read(r.getResponse().getContentAsString(), "$.accessToken");
    }

    private static String body(boolean minimap, String chat, String w, String h) {
        return "{\"minimap\":" + minimap + ",\"leaderboard\":false,\"chat\":\"" + chat + "\",\"help\":false,\"autoFullscreen\":false,\"sideHidden\":true,"
                + "\"sideWidth\":" + w + ",\"sideHeight\":" + h + "}";
    }

    @Test
    void unsavedAccountGetsDefaults() throws Exception {
        mvc.perform(get("/api/me/ui-settings").header("Authorization", "Bearer " + guest())).andExpect(status().isOk())
                .andExpect(jsonPath("$.saved").value(false)).andExpect(jsonPath("$.minimap").value(true)).andExpect(jsonPath("$.chat").value("collapsed"))
                .andExpect(jsonPath("$.sideWidth").doesNotExist()).andExpect(jsonPath("$.sideHeight").doesNotExist());
    }

    @Test
    void savedValuesComeBackAndSizesCanBeCleared() throws Exception {
        String t = guest();
        mvc.perform(put("/api/me/ui-settings").header("Authorization", "Bearer " + t).contentType(MediaType.APPLICATION_JSON).content(body(false, "open", "480", "300")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.saved").value(true));
        mvc.perform(get("/api/me/ui-settings").header("Authorization", "Bearer " + t)).andExpect(jsonPath("$.saved").value(true))
                .andExpect(jsonPath("$.minimap").value(false)).andExpect(jsonPath("$.leaderboard").value(false)).andExpect(jsonPath("$.chat").value("open"))
                .andExpect(jsonPath("$.help").value(false)).andExpect(jsonPath("$.autoFullscreen").value(false)).andExpect(jsonPath("$.sideHidden").value(true))
                .andExpect(jsonPath("$.sideWidth").value(480)).andExpect(jsonPath("$.sideHeight").value(300));
        // 크기를 null로 보내면 기본 크기로 돌아간다
        mvc.perform(put("/api/me/ui-settings").header("Authorization", "Bearer " + t).contentType(MediaType.APPLICATION_JSON).content(body(true, "off", "null", "null")))
                .andExpect(status().isOk());
        mvc.perform(get("/api/me/ui-settings").header("Authorization", "Bearer " + t)).andExpect(jsonPath("$.chat").value("off"))
                .andExpect(jsonPath("$.sideWidth").doesNotExist()).andExpect(jsonPath("$.sideHeight").doesNotExist());
    }

    @Test
    void invalidValuesAreRejected() throws Exception {
        String t = guest();
        for (String bad : new String[] {body(true, "weird", "400", "300"), body(true, "open", "100", "300"), body(true, "open", "400", "5000")}) {
            mvc.perform(put("/api/me/ui-settings").header("Authorization", "Bearer " + t).contentType(MediaType.APPLICATION_JSON).content(bad))
                    .andExpect(status().is4xxClientError());
        }
    }

    @Test
    void eachAccountHasItsOwnSettingsAndLoginIsRequired() throws Exception {
        String a = guest(), b = guest();
        mvc.perform(put("/api/me/ui-settings").header("Authorization", "Bearer " + a).contentType(MediaType.APPLICATION_JSON).content(body(false, "open", "400", "300")))
                .andExpect(status().isOk());
        mvc.perform(get("/api/me/ui-settings").header("Authorization", "Bearer " + b)).andExpect(jsonPath("$.saved").value(false));
        mvc.perform(get("/api/me/ui-settings")).andExpect(status().is4xxClientError());
    }
}

package com.trendist.sound;

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

/** 계정별 소리 설정(4.39): 저장한 적이 없으면 기본값(saved=false), 저장하면 그대로 돌려주고, 범위를 넘으면 거절하며, 계정마다 따로다 */
@SpringBootTest
@ActiveProfiles("test")
@AutoConfigureMockMvc
class SoundSettingApiTest {
    @Autowired MockMvc mvc;

    private String guest() throws Exception {
        MvcResult r = mvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        return JsonPath.read(r.getResponse().getContentAsString(), "$.accessToken");
    }

    private static final String BODY = "{\"sfx\":false,\"bgm\":true,\"master\":35,\"sfxVolume\":70,\"bgmVolume\":20}";

    @Test
    void unsavedAccountGetsDefaults() throws Exception {
        mvc.perform(get("/api/me/sound").header("Authorization", "Bearer " + guest())).andExpect(status().isOk())
                .andExpect(jsonPath("$.saved").value(false)).andExpect(jsonPath("$.sfx").value(true)).andExpect(jsonPath("$.bgm").value(false))
                .andExpect(jsonPath("$.master").value(80)).andExpect(jsonPath("$.sfxVolume").value(80)).andExpect(jsonPath("$.bgmVolume").value(50));
    }

    @Test
    void savedValuesComeBackAndCanBeOverwritten() throws Exception {
        String t = guest();
        mvc.perform(put("/api/me/sound").header("Authorization", "Bearer " + t).contentType(MediaType.APPLICATION_JSON).content(BODY)).andExpect(status().isOk())
                .andExpect(jsonPath("$.saved").value(true));
        mvc.perform(get("/api/me/sound").header("Authorization", "Bearer " + t)).andExpect(jsonPath("$.saved").value(true)).andExpect(jsonPath("$.sfx").value(false))
                .andExpect(jsonPath("$.bgm").value(true)).andExpect(jsonPath("$.master").value(35)).andExpect(jsonPath("$.sfxVolume").value(70)).andExpect(jsonPath("$.bgmVolume").value(20));
        mvc.perform(put("/api/me/sound").header("Authorization", "Bearer " + t).contentType(MediaType.APPLICATION_JSON).content("{\"sfx\":true,\"bgm\":false,\"master\":0,\"sfxVolume\":100,\"bgmVolume\":0}")).andExpect(status().isOk());
        mvc.perform(get("/api/me/sound").header("Authorization", "Bearer " + t)).andExpect(jsonPath("$.master").value(0)).andExpect(jsonPath("$.sfxVolume").value(100)).andExpect(jsonPath("$.sfx").value(true));
    }

    @Test
    void outOfRangeVolumeIsRejected() throws Exception {
        String t = guest();
        mvc.perform(put("/api/me/sound").header("Authorization", "Bearer " + t).contentType(MediaType.APPLICATION_JSON).content("{\"sfx\":true,\"bgm\":true,\"master\":101,\"sfxVolume\":50,\"bgmVolume\":50}")).andExpect(status().is4xxClientError());
        mvc.perform(put("/api/me/sound").header("Authorization", "Bearer " + t).contentType(MediaType.APPLICATION_JSON).content("{\"sfx\":true,\"bgm\":true,\"master\":50,\"sfxVolume\":-1,\"bgmVolume\":50}")).andExpect(status().is4xxClientError());
    }

    @Test
    void eachAccountHasItsOwnSettingsAndLoginIsRequired() throws Exception {
        String a = guest(), b = guest();
        mvc.perform(put("/api/me/sound").header("Authorization", "Bearer " + a).contentType(MediaType.APPLICATION_JSON).content(BODY)).andExpect(status().isOk());
        mvc.perform(get("/api/me/sound").header("Authorization", "Bearer " + b)).andExpect(jsonPath("$.saved").value(false));
        mvc.perform(get("/api/me/sound")).andExpect(status().is4xxClientError());
    }
}

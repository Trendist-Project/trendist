package com.trendist.system;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/** 관리자 서버 가동 시간: 관리자만 읽을 수 있고, 시작 시각과 경과 시간을 준다 */
@SpringBootTest
@ActiveProfiles("test")
@AutoConfigureMockMvc
class AdminSystemTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    private String login(boolean admin) throws Exception {
        MvcResult r = mvc.perform(post("/api/auth/guest")).andReturn();
        String token = JsonPath.read(r.getResponse().getContentAsString(), "$.accessToken");
        if (admin) {
            String payload = new String(java.util.Base64.getUrlDecoder().decode(token.split("\\.")[1]), StandardCharsets.UTF_8);
            jdbc.update("update users set role = 'ADMIN' where id = ?", Long.parseLong(JsonPath.read(payload, "$.sub")));
        }
        return "Bearer " + token;
    }

    @Test
    void 관리자는_가동_시간을_읽고_일반_사용자는_막힌다() throws Exception {
        mvc.perform(get("/api/admin/system").header("Authorization", login(true)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.startedAt").isNotEmpty())
            .andExpect(jsonPath("$.uptimeMillis").isNumber());
        mvc.perform(get("/api/admin/system").header("Authorization", login(false))).andExpect(status().isForbidden());
    }
}

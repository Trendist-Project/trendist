plugins {
    java
    id("org.springframework.boot") version "4.1.2"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "com.trendist"
version = "0.1.0"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-websocket")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-flyway") // DB 마이그레이션(src/main/resources/db/migration). 테스트(H2)에서는 꺼 둔다
    implementation("org.flywaydb:flyway-mysql")                          // MySQL 8·MariaDB 지원
    implementation("com.github.ben-manes.caffeine:caffeine")
    implementation("org.hibernate.orm:hibernate-jcache")                 // 엔티티 2차 캐시(키워드·상태·레벨 같은 읽기 위주 데이터)
    implementation("com.github.ben-manes.caffeine:jcache:3.2.4")          // 그 캐시를 Caffeine으로 구현(JCache)
    implementation("org.springframework.security:spring-security-oauth2-jose") // 구글 ID 토큰(JWT) 서명 검증(9.3)

    compileOnly("org.projectlombok:lombok")
    annotationProcessor("org.projectlombok:lombok")
    testCompileOnly("org.projectlombok:lombok")
    testAnnotationProcessor("org.projectlombok:lombok")

    runtimeOnly("org.mariadb.jdbc:mariadb-java-client") // MariaDB 접속용(현재 개발 DB는 mysql 드라이버를 쓴다)
    runtimeOnly("com.mysql:mysql-connector-j")         // mysql 프로필(MySQL 8)
    testRuntimeOnly("com.h2database:h2")               // 테스트는 H2 메모리 DB

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test> {
    useJUnitPlatform()
    // 방의 난수(봇 움직임·구슬 자리 등)를 고정해 테스트가 매번 같은 결과를 내게 한다(Room.SEED_PROPERTY)
    systemProperty("trendist.room.seed", "20261113")
    // 실패한 시험의 메시지까지 로그에 남긴다(CI에서만 나는 실패의 원인을 보려고)
    testLogging { exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}

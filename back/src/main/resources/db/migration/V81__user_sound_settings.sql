-- 계정별 소리 설정(4.39): 마스터·효과음·배경음의 켜짐과 음량(0~100). 계정(users)마다 한 줄이고 나라와 무관하다(KR·GLOBAL 플레이어가 같은 설정을 쓴다).
-- 행이 없으면 저장한 적이 없는 것이고, 화면은 이 브라우저에 있던 값을 올려 보낸다. 계정을 지우면 함께 지운다
create table user_sound_settings (
    id bigint not null auto_increment,
    created_at DATETIME(6) not null,
    updated_at DATETIME(6) not null,
    user_id bigint not null,
    sfx_on boolean not null,
    bgm_on boolean not null,
    master_volume int not null,
    sfx_volume int not null,
    bgm_volume int not null,
    primary key (id),
    unique key uk_user_sound_settings_user (user_id),
    constraint fk_user_sound_settings_user foreign key (user_id) references users (id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- 계정별 게임 화면 설정(4.45): 미니맵·리더보드·채팅·조작 설명·자동 전체 화면·오른쪽 영역(보관함) 숨김과 크기. 계정(users)마다 한 줄이고 나라와 무관하다.
-- 행이 없으면 저장한 적이 없는 것이고, 화면은 이 브라우저에 있던 값을 올려 보낸다. side_width·side_height가 NULL이면 사용자 지정 크기 없이 기본 크기를 쓴다. 계정을 지우면 함께 지운다
create table user_ui_settings (
    id bigint not null auto_increment,
    created_at DATETIME(6) not null,
    updated_at DATETIME(6) not null,
    user_id bigint not null,
    minimap_on boolean not null,
    leaderboard_on boolean not null,
    chat_view varchar(12) not null,
    help_open boolean not null,
    auto_fullscreen boolean not null,
    side_hidden boolean not null,
    side_width int null,
    side_height int null,
    primary key (id),
    unique key uk_user_ui_settings_user (user_id),
    constraint fk_user_ui_settings_user foreign key (user_id) references users (id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

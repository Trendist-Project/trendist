-- 키워드 합성(4.44): 합성 키워드는 keywords의 한 행이지만 검색에 나오지 않는다(normalized가 `~` + 구성 번호 해시라 입력할 수 없는 값).
-- star_count는 구성 원본(1성) 키워드 수, 일반 키워드는 1. 구성 원본은 keyword_merge_parts에 둔다.
alter table keywords
    add column is_merged tinyint(1) not null default 0 comment '합성 키워드 여부(4.44)',
    add column star_count int not null default 1 comment '성(★) = 구성 원본(1성) 키워드 수(4.44)';

create table keyword_merge_parts (
    keyword_id      bigint not null comment '합성 키워드(keywords.is_merged = 1)',
    part_keyword_id bigint not null comment '구성 원본(1성) 키워드',
    primary key (keyword_id, part_keyword_id),
    key idx_keyword_merge_parts_part (part_keyword_id),
    constraint fk_keyword_merge_parts_keyword foreign key (keyword_id) references keywords (id) on delete cascade,
    constraint fk_keyword_merge_parts_part foreign key (part_keyword_id) references keywords (id)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci comment='합성 키워드의 구성 원본(4.44)';

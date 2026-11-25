-- 보관함 한 행을 만든 + 요청의 번호(추적용, 36자 UUID). 기존 행은 NULL이다.
-- 키워드 워커(docs/plans/keyword-worker.md)에서 + 한 번을 한 트랜잭션으로 묶으므로 중복 방지에는 쓰지 않고, 로그와 행을 잇는 용도다.
alter table player_keywords add column request_id varchar(36) null;

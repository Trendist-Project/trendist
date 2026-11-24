-- 아레나 조명·날씨의 기본값을 현실 시간 자동(1)·실제 날씨(1)로, 글로벌 서버 기준 위치를 런던에서 미국 수도(워싱턴 D.C.)로 바꾼다(4.38).
-- 이미 만들어진 행 중 관리자가 한 번도 고치지 않은 값(옛 기본값)만 새 기본값으로 바꾼다. 행이 아직 없으면 시더가 새 기본값으로 만든다
update settings set value = '1'
 where name = 'arena_light_mode' and value = '0'
   and not exists (select 1 from config_changes c where c.scope = 'SETTING' and c.target = 'arena_light_mode');
update settings set value = '1'
 where name = 'arena_weather_mode' and value = '0'
   and not exists (select 1 from config_changes c where c.scope = 'SETTING' and c.target = 'arena_weather_mode');
update settings set value = '38.9072'
 where name = 'arena_global_lat' and value = '51.5'
   and not exists (select 1 from config_changes c where c.scope = 'SETTING' and c.target = 'arena_global_lat');
update settings set value = '-77.0369'
 where name = 'arena_global_lon' and value = '0.0'
   and not exists (select 1 from config_changes c where c.scope = 'SETTING' and c.target = 'arena_global_lon');

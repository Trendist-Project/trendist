-- ? 구슬에서 🔥활성 키워드를 얻을 확률(orb_active_percent) 기본값을 60 → 100으로 바꿨다. 이전 기본값(60) 그대로인 행만 바꾼다(운영에서 고친 값은 건드리지 않는다).
update settings set value = '100' where name = 'orb_active_percent' and value = '60';

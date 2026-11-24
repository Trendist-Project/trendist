/** 성능 점검용 서버 메시지 통계(PerfHud가 읽는다). 연결이 메시지를 받을 때마다 올라가며, 켜지 않아도 숫자 몇 개만 더하는 정도라 부담이 없다. */
export const wsStats = { snapshots: 0, texts: 0, bytes: 0 };

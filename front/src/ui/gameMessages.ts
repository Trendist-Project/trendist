import { mineBus, type MineEvent } from './mineBus';
import { setLeaderboard } from './leaderboardStore';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { EmergencyNotice, PlayerSummary } from '../api/types';
import type { Arena } from '../game/Arena';
import type { GameConnection } from '../game/connection';
import { isPartLoss, type ChatMessage, type LossCause, type ServerMessage } from '../game/protocol';
import { setCurrentSlots } from '../game/skillKeys';
import { normalizeFxId, normalizeSkillCode } from '../game/skills';
import { getLang } from '../country';
import { t } from '../i18n';
import type { ChatLine } from './ChatPanel';
import type { MonsterNote } from './MonsterHud';
import { ORB_REVEAL_MS, type RevealResult } from './OrbReveal';
import type { DashState, SkillCooldowns } from './SkillBar';
import { handleSelfStatus, type SkillLock } from './selfStatusMessages';
import { playSfx } from '../game/sound';
import { pushFeed, type FeedLine } from './KillFeed';

/**
 * 서버가 보낸 게임 메시지(protocol.ts의 ServerMessage)를 화면 상태와 아레나에 반영한다(8절). GameScreen의 연결 이펙트가 메시지마다 부른다.
 * 화면 상태는 React setter로, 그림은 Arena로 넘긴다. 이 파일은 상태를 들고 있지 않고 GameMessageContext로 받은 것만 쓴다.
 */

/** 화면에 쌓아 두는 채팅 줄 수 */
export const CHAT_KEEP = 200;

/** 연결 하나 동안 이펙트 안에서 바뀌는 값: 방에 들어갔는지(welcome 뒤 끊기기 전까지), 내 원 번호, 누르고 있는 방향키를 다시 보내는 함수 */
export interface GameSession { ready: boolean; myEntity: number; resyncDir: () => void }

type Set<T> = Dispatch<SetStateAction<T>>;
/** 화면의 상태 모양(GameScreen의 useState와 같다) */
export interface MyHp { pct: number; flash: { kind: 'hit' | 'heal'; key: number } | null; barrier?: number }
export interface DeadState { by: string; waiting: boolean; hp?: boolean }
export interface MyCombo { combo: number; flameAt: number; key: number; until: number | null }

export interface GameMessageContext {
  arena: Arena;
  conn: GameConnection;
  sess: GameSession;
  skillLock: SkillLock;
  toLine: (m: ChatMessage) => ChatLine;
  hookedUntilRef: MutableRefObject<number>;
  myEntityRef: MutableRefObject<number>;
  showReveal: (r: RevealResult) => void;
  showTitleAlert: (titleId: number, name: string, description: string) => void;
  showToast: (msg: string, img?: string) => void;
  flashSkill: (id: string) => void; // 스킬을 쓰지 못했을 때 그 스킬 칸을 깜빡인다
  applyEmergency: (n: EmergencyNotice | null) => void;
  setPlayer: Set<PlayerSummary>;
  setOnline: Set<number>;
  setBots: Set<number>;
  setMonsterNote: Set<MonsterNote | null>;
  setMyBossDmg: Set<{ dmg: number; hits: number }>;
  setKicked: Set<string | null>;
  setMyHp: Set<MyHp>;
  setSkillOn: Set<ReadonlySet<string>>; // 켜고 끄는 스킬(광폭화)이 지금 켜져 있는 코드들
  setDead: Set<DeadState | null>;
  setMyCombo: Set<MyCombo>;
  setHit: Set<{ text: string; key: number } | null>;
  setDash: Set<DashState | null>;
  setSkillCd: Set<SkillCooldowns>;
  setSkillActive: Set<SkillCooldowns>;
  setHookedUntil: Set<number | null>;
  setSlots: Set<(string | null)[]>;
  setRefreshKey: Set<number>;
  setOrbReveal: Set<{ result: RevealResult; key: number } | null>;
  setPingMs: Set<number | null>;
  setChatLines: Set<ChatLine[]>;
  setFeed: Set<FeedLine[]>; // 방 전체의 싸움 소식(킬 피드, 4.41)
  tutorialEvent: (e: 'plus' | 'fight') => void; // 첫 입장 튜토리얼(4.43)에 사건을 알린다
}

/** 연속 처치(멀티킬): 10초 안에 이어 쓰러뜨리면 이어진다. 내 것과 킬 피드의 다른 사람 것을 따로 센다 */
const MULTI_MS = 10000;
const myStreak = new WeakMap<GameSession, { n: number; at: number }>();
const foeStreak = new Map<number, { n: number; at: number }>();
let feedId = 0;

/** 스킬에 맞아 키워드를 잃었을 때 결과 카드 제목: 스킬 이름만 바꿔 한 문장을 같이 쓴다(스킬이 늘어도 문구를 더하지 않는다) */
const SKILL_LOSS: LossCause[] = ['poison', 'quake', 'fireball', 'slow', 'darkness', 'silence', 'stun', 'root', 'confuse', 'zone', 'burst'];
const lostTitle = (cause: LossCause): string | undefined => SKILL_LOSS.includes(cause) ? t('gamescreen.skillLostTitle', { skill: t(`skills.${cause}_name`) }) : undefined;

type ScoreMsg = Extract<ServerMessage, { type: 'score' }>;
let scoreCooling = false;
let scorePending: ScoreMsg | null = null;
function pushScore(m: ScoreMsg, setPlayer: GameMessageContext['setPlayer']) {
  const apply = (s: ScoreMsg) => setPlayer((p) => ({ ...p, currentScore: s.score, exp: s.exp, nextLevelExp: s.nextExp, level: s.level, holdCount: s.holdCount }));
  if (scoreCooling) { scorePending = m; return; }
  apply(m);
  scoreCooling = true;
  window.setTimeout(() => { scoreCooling = false; if (scorePending) { const last = scorePending; scorePending = null; apply(last); } }, 150);
}

/**
 * 구슬 결과 묶음 보여 주기: 한꺼번에 여러 개를 먹으면 결과가 잇따라 오는데, 하나씩 카드·떠오르는 글자·목록 갱신을 하면 브라우저가 그만큼 일을 한다.
 * 맨 처음 결과는 바로 처리하고, 그 뒤 ORB_BATCH_MS(0.1초) 안에 온 것은 모아서 끝에 한 번에 처리한다: 결과 카드는 마지막 키워드 하나만, 떠오르는 점수는 합계 하나, 소리는 한 번, 보관함 목록은 한 번에 고친다.
 */
const ORB_BATCH_MS = 100;
type OrbMsg = Extract<ServerMessage, { type: 'orbResult' }>;
let orbBuf: OrbMsg[] = [];
let orbTimer = 0;
function pushOrb(m: OrbMsg, c: GameMessageContext) {
  if (orbTimer) { orbBuf.push(m); return; } // 모으는 중: 마지막에 한꺼번에
  flushOrbs([m], c); // 맨 처음 것은 기다리지 않고 바로 보여 준다(구슬 하나만 먹으면 지연이 없다)
  orbTimer = window.setTimeout(() => { orbTimer = 0; if (orbBuf.length > 0) { const batch = orbBuf; orbBuf = []; flushOrbs(batch, c); } }, ORB_BATCH_MS);
}

function flushOrbs(batch: OrbMsg[], c: GameMessageContext) {
  if (batch.length === 0) return;
  // 구슬이 원 안으로 빨려 들어간 뒤에 결과 카드를 띄운다. 키워드가 걸린 마지막 결과를 보여 주고, 없으면(꽝·없음) 마지막 것
  const shown = [...batch].reverse().find((r) => r.status === 'GAINED' || r.status === 'RENEWED' || r.status === 'LOST') ?? batch[batch.length - 1];
  playSfx('orb');
  const key = performance.now();
  const kind = shown.status === 'GAINED' || shown.status === 'RENEWED' ? 'GAIN' : shown.status === 'LOST' ? 'LOSE' : undefined;
  window.setTimeout(() => c.setOrbReveal({ result: { ...shown, kind }, key }), 250);
  window.setTimeout(() => c.setOrbReveal((cur) => (cur?.key === key ? null : cur)), 250 + ORB_REVEAL_MS);
  // 떠오르는 점수는 얻은 점수와 잃은 점수의 합계 하나
  let net = 0;
  for (const r of batch) { if (r.status === 'GAINED') net += r.gained ?? 0; else if (r.status === 'LOST') net -= r.gained ?? 0; }
  if (net > 0) c.arena.floatText(`+${net}`); else if (net < 0) c.arena.floatText(`${net}`);
  // 보관함 목록: 새로 얻었거나 만료만 갱신한 것은 서버가 알려 준 키워드 번호로 목록을 직접 고치고(전체를 다시 읽지 않는다), 잃은 것은 어떤 카드가 바뀌었는지 몰라 한 번 다시 읽는다
  const events: MineEvent[] = [];
  let reload = false;
  for (const r of batch) {
    if ((r.status === 'GAINED' || r.status === 'RENEWED') && r.keywordId != null && r.text && r.expiresAt) {
      events.push({ kind: r.status === 'GAINED' ? 'gain' : 'renew', keywordId: r.keywordId, text: r.text, state: r.state as never, trendValue: Number(r.trendValue ?? 0), expiresAt: String(r.expiresAt) });
    } else if (r.status === 'GAINED' || r.status === 'RENEWED' || r.status === 'LOST') reload = true;
  }
  if (events.length > 0) mineBus.emit(events);
  if (reload) c.setRefreshKey((k) => k + 1);
}

export function handleGameMessage(m: ServerMessage, c: GameMessageContext) {
  const { arena, conn, sess, skillLock, toLine, hookedUntilRef, myEntityRef, showReveal, showTitleAlert, showToast, flashSkill, applyEmergency, setPlayer, setOnline, setBots, setMonsterNote, setMyBossDmg, setKicked, setMyHp, setSkillOn, setDead, setMyCombo, setHit, setDash, setSkillCd, setSkillActive, setHookedUntil, setSlots, setRefreshKey, setPingMs, setChatLines, setFeed, tutorialEvent } = c;
  switch (m.type) {
    case 'welcome':
      setDead(null); arena.setDead(false); // 처음 들어왔거나 리스폰했다
      setDash(null); arena.resetDash(); // 새 원이라 대시 남은 시간·쿨타임 표시도 지운다(서버는 이미 초기화)
      setSkillCd({}); setSkillActive({}); arena.resetSkills(); hookedUntilRef.current = 0; setHookedUntil(null); // 스킬 쿨타임과 연출도(4.33)
      arena.setMe(m.entityNo, m.x, m.y);
      arena.resendView(); // 다시 들어왔으니 보이는 범위를 서버에 다시 알린다
      sess.myEntity = m.entityNo;
      myEntityRef.current = m.entityNo;
      sess.ready = true;
      sess.resyncDir(); // 다시 연결됐을 때 아직 누르고 있는 방향키가 있으면 서버와 예측에 함께 다시 넣는다
      conn.send({ type: 'ping', t: performance.now() });
      break;
    case 'monster': arena.setMonster(m); break; // 보스 상태(5Hz, 4.35)
    case 'monsterFx': arena.monsterFx(m); break;
    case 'monsterAlert': playSfx('boss'); showToast(t('monster.alert', { name: getLang() === 'en' && m.en ? m.en : m.name, sec: Math.max(1, Math.round(m.seconds)) }), m.img ?? ''); break;
    case 'monsterSpawn':
      playSfx('boss');
      setMyBossDmg({ dmg: 0, hits: 0 }); setMonsterNote(null);
      showToast(t('monster.spawn', { name: getLang() === 'en' && m.en ? m.en : m.name, min: Math.max(1, Math.round(m.durationMs / 60000)) }), m.img ?? '');
      break;
    case 'monsterHit':
      arena.monsterHit(m);
      if (m.e === sess.myEntity) { // 내가 입힌 피해는 보스 위 숫자로만 보인다(내 원 위 글씨는 중복이라 뺐다)
        setMyBossDmg((d) => ({ dmg: d.dmg + m.dmg, hits: d.hits + 1 }));
      }
      break;
    case 'monsterEnd':
      if (m.result === 'KILLED') arena.vanishMonster(); else arena.clearMonster(); // 처치하면 증발 연출, 시간이 다 되면 그냥 사라진다
      setMonsterNote({ key: performance.now(), kind: 'end', result: m.result, name: m.name, en: m.en, top: m.top });
      window.setTimeout(() => setMonsterNote((n) => (n && n.kind === 'end' ? null : n)), 12000);
      break;
    case 'monsterReward':
      setMonsterNote({ key: performance.now(), kind: 'reward', name: m.name, en: m.en, cleared: m.cleared, rank: m.rank, damage: m.damage, exp: m.exp, levelPercent: m.levelPercent ?? 0, keywords: m.keywords });
      window.setTimeout(() => setMonsterNote((n) => (n && n.kind === 'reward' ? null : n)), 15000);
      setRefreshKey((k) => k + 1);
      break;
    case 'tuning': arena.setTuning(m); break;
    case 'emergency': applyEmergency(m.notice); break;
    case 'titleGranted': showTitleAlert(m.titleId, m.name, m.description); break;
    case 'roster': arena.setRoster(m.players, m.flameAt); setOnline(m.players.filter((p) => !p.bot).length); setBots(m.players.filter((p) => p.bot).length); break;
    case 'score': // 점수 메시지가 잇따라 와도 0.15초에 한 번만 화면에 반영한다(맨 처음 것은 바로, 그 사이 온 것은 마지막 값만)
      pushScore(m, setPlayer);
      break;
    case 'leaderboard': setLeaderboard({ top: m.top, me: m.me }); break; // 실시간 랭킹은 소켓으로 받는다(조회하지 않는다)
    case 'pong': {
      const ms = performance.now() - m.t;
      arena.updateRtt(ms);
      if (Number.isFinite(ms) && ms >= 0 && ms < 5000) setPingMs((p) => (p === null ? Math.round(ms) : Math.round(p * 0.6 + ms * 0.4))); // 튀는 값에 깜빡이지 않게 조금씩 따라간다
      break;
    }
    case 'orbs': arena.setOrbs(m.orbs); break;
    case 'orbSpawn': arena.addOrb(m.id, m.x, m.y, m.prize); break;
    case 'orbEaten': arena.eatOrb(m.id, m.e); break;
    case 'safeZones': arena.setSafeZones(m.center, m.zones); break;
    case 'orbResult':
      pushOrb(m, c); // 짧은 시간에 잇따라 온 구슬 결과는 모아서 한 번에 보여 준다(아래 flushOrbs)
      break;
    case 'chat':
      arena.showBubble(m.e, m.text);
      setChatLines((lines) => [...lines, toLine(m)].slice(-CHAT_KEEP));
      break;
    case 'chatHistory':
      // 다시 연결되면 최근 채팅이 다시 오므로 번호로 합친다
      setChatLines((lines) => {
        const seen = new Set(lines.map((l) => l.id));
        return [...lines, ...m.messages.filter((x) => !seen.has(x.id)).map(toLine)].sort((a, b) => a.id - b.id).slice(-CHAT_KEEP);
      });
      break;
    case 'chatError': showToast(m.message); break;
    case 'kicked': conn.stop(); setKicked(m.message); break;
    case 'emote': arena.showEmote(m.e, m.code); break;
    case 'combo': {
      // 연속 빼앗기 콤보와 불꽃(4.25). 콤보 수는 화면 위 카드로만 보이고, 원 위로 떠오르는 글자는 띄우지 않는다(점수 글자와 겹치지 않게)
      arena.setCombo(m.e, m.combo, m.flameAt);
      const mine = m.e === sess.myEntity;
      if (mine && (m.event === 'up' || m.event === 'start')) playSfx('combo');
      if (mine) {
        // 콤보가 오를 때마다 유지시간이 다시 시작되므로(4.25) 그때 사라질 시각을 새로 잡는다
        const rose = m.event === 'up' || m.event === 'start';
        setMyCombo((c) => ({ combo: m.combo, flameAt: m.flameAt, key: c.key + (rose ? 1 : 0),
          until: rose ? (m.maxMs ? performance.now() + m.maxMs : null) : c.until }));
      }
      // 다른 사람이 불꽃을 얻었다는 안내는 띄우지 않는다(불꽃은 그 원 둘레로 보인다)
      if (m.event === 'broken') {
        if (mine) showToast(t('gamescreen.flameOut', { by: m.by ?? t('gamescreen.someone') }));
      }
      break;
    }
    case 'lost': {
      // 어떤 키워드를 몇 점짜리로 잃었는지 보여 준다(4.3). 원인은 cause 하나로 고른다(서버 LossMessages)
      const who = m.by || undefined;
      if (isPartLoss(m.cause)) showReveal({ type: 'orbResult', status: 'LOST', wipe: m.count, who, lostLabel: t(m.cause === 'death' ? 'gamescreen.lostPartDeath' : 'gamescreen.lostPartFlame') }); // 일부를 잃었다(4.36)
      else showReveal({ type: 'orbResult', status: 'LOST', text: m.keyword ?? '', gained: m.score, kind: m.stolen ? 'STOLEN' : 'LOSE', who, lostCount: m.count, lostLabel: lostTitle(m.cause) }); // 아무도 가져가지 않은 것은 '뺏김'이 아니라 '잃음'
      if (m.score > 0) arena.floatText(`-${m.score}`, '#ff8a8a');
      tutorialEvent('fight'); playSfx('lose'); arena.hitReact('taken'); // 잃는 순간의 소리·흔들림(4.39)
      setRefreshKey((k) => k + 1);
      break;
    }
    case 'hit': {
      // 공격 성공: 상대가 잃은 키워드와 점수를 내 화면에 보여 준다.
      // 사람에게서 이기면 그 키워드를 빼앗는다: 없던 키워드는 보관함에 추가, 이미 있던 키워드는 남은 시간 갱신(4.3)
      // 봇을 이기면 봇이 잃은 그 키워드를 얻는다. 이미 가진 키워드면 남은 시간 갱신(4.21)
      const key = performance.now();
      const part = isPartLoss(m.cause);
      const hp = { target: m.target ?? '', kw: m.keyword ?? '', score: m.score ?? 0, n: m.count ?? 0 };
      tutorialEvent('fight'); playSfx(m.stolen ? 'gain' : 'hit'); arena.hitReact('dealt', m.target); // 이긴 순간의 소리·파편(4.39)
      const gainedBy = !!m.stolen; // 키워드를 얻었다(빼앗음·봇을 이겨 획득): 구슬과 같은 결과 카드로 보여 준다
      if (gainedBy) {
        showReveal({ type: 'orbResult', status: m.stolen === 'ADDED' || m.stolen === 'BOT' ? 'GAINED' : 'RENEWED', text: m.keyword ?? '', gained: m.gained,
                     kind: 'STEAL', who: m.target || undefined });
      }
      const text = part ? t('gamescreen.hitPart', hp)
        : m.stolen === 'BOT' ? t('gamescreen.hitBot', hp)
        : m.stolen === 'BOT_RENEWED' ? t('gamescreen.hitBotRenewed', hp)
        : m.stolen === 'ADDED' ? t('gamescreen.hitAdded', hp)
        : m.stolen === 'RENEWED' ? t('gamescreen.hitRenewed', hp)
        : m.keyword ? t('gamescreen.hitDropped', hp) : t('gamescreen.hitWon', hp);
      if (part) showReveal({ type: 'orbResult', status: 'GAINED', wipe: m.count, who: m.target || undefined, lostLabel: t('gamescreen.hitPartTitle') });
      else if (!gainedBy) setHit({ text, key });
      if (m.stolen) {
        if (m.gained) arena.floatText(`+${m.gained}`);
        setRefreshKey((k) => k + 1); // 보관함 목록 새로고침
      }
      if (!gainedBy && !part) window.setTimeout(() => setHit((h) => (h?.key === key ? null : h)), 3000);
      break;
    }
    case 'died':
      // 죽음(4.31): 입력을 끊고 마지막 장면을 흑백으로 두며, 누가 죽였는지 알려 준다
      playSfx('death'); arena.hitReact('death');
      sess.ready = false; arena.clearControl();
      setDead({ by: m.by, waiting: false, hp: m.cause === 'hp' }); arena.setDead(true);
      arena.clearHp(); setMyHp({ pct: 100, flash: null }); // 다시 들어오면 체력은 가득이다(4.36)
      break;
    case 'hp': { // 내 체력(4.36)
      if (sess.myEntity !== -1 && m.e !== sess.myEntity) break; // hp는 본인에게만 온다. 접속 직후엔 welcome보다 먼저 와서 myEntity가 아직 -1이니 버리면 안 된다
      arena.setHp(m.e, m.pct);
      setMyHp((h) => ({ pct: m.pct, flash: m.heal ? { kind: 'heal', key: performance.now() } : h.flash, barrier: h.barrier }));
      if (m.heal) arena.healPop(m.e);
      break;
    }
    case 'hps': arena.setHps(m.list); break; // 체력바 공개 설정일 때 모두의 체력
    case 'hpHit': { // 누가 맞았다: 그 원 위에 깎인 %를 띄운다. 내 체력바는 바로 줄인다
      arena.hpPop(m.e, `-${Math.max(1, m.pct > 0 ? Math.min(99, Math.round(m.dmg)) : Math.round(m.dmg))}%`, m.e === sess.myEntity ? 'taken' : arena.isFlaming(m.by) ? 'crit' : 'other'); // 내가 입은 피해는 보라, 불꽃으로 때린 피해는 분홍 크리티컬, 나머지는 주황
      if (m.e === sess.myEntity) {
        playSfx('hurt'); arena.hitReact('hurt');
        arena.setHp(m.e, m.pct);
        setMyHp((h) => ({ pct: m.pct, flash: { kind: 'hit', key: performance.now() }, barrier: h.barrier }));
      }
      break;
    }
    case 'kill': { // 내가 죽였다(4.31)
      showReveal({ type: 'orbResult', status: 'GAINED', kill: m.target });
      playSfx('kill'); arena.hitReact('kill', m.target);
      // 연속 처치: 10초 안에 이어서 쓰러뜨리면 큰 글자로 알린다(4.41)
      const now = performance.now(), prev = myStreak.get(sess), n = prev && now - prev.at < MULTI_MS ? prev.n + 1 : 1;
      myStreak.set(sess, { n, at: now });
      if (n >= 2) arena.announce(t(`gamescreen.multiKill${Math.min(5, n)}`), n >= 5 ? '#ff5ad6' : n >= 3 ? '#ff8a3d' : '#ffe27a', t('gamescreen.multiKillSub', { n }));
      break;
    }
    case 'feed': { // 방 전체의 싸움 소식(4.41): 쓰러뜨림은 같은 사람이 연달아 한 횟수도 붙인다
      const now = performance.now();
      let streak = 0;
      if (m.kind === 'kill') {
        const prev = foeStreak.get(m.byE);
        streak = prev && now - prev.at < MULTI_MS ? prev.n + 1 : 1;
        foeStreak.set(m.byE, { n: streak, at: now });
        if (foeStreak.size > 64) for (const [k, v] of foeStreak) if (now - v.at >= MULTI_MS) foeStreak.delete(k);
      }
      setFeed((l) => pushFeed(l, { id: ++feedId, kind: m.kind, by: m.by, target: m.target, mine: m.byE === sess.myEntity, victim: m.tE === sess.myEntity, streak, at: now }));
      break;
    }
    case 'invincibility': arena.showInvincible(m.e, m.ms); break;
    case 'knock': arena.applyKnock(m.dx, m.dy, m.ms); break;
    case 'levelFx': arena.showLevelFx(m.e, m.level); if (m.e === sess.myEntity) playSfx('levelup'); break; // 레벨업 이펙트(4.30)
    case 'dashFx': arena.showDashFx(m.e, m.ms); break; // 누군가 대시를 시작했다: 그 원에 강조 효과(4.27)
    case 'skill': { // 내가 스킬을 썼다(4.33): 쿨타임 표시
      playSfx('skill');
      const at = performance.now() + m.cooldownMs, code = normalizeSkillCode(m.id);
      setSkillCd((c) => ({ ...c, [code]: at }));
      if ((m.activeMs ?? 0) > 0) setSkillActive((a) => ({ ...a, [code]: performance.now() + (m.activeMs ?? 0) })); // 효과가 이어지는 동안 칸에 켜져 있음 표시(광폭화와 같은 표시)
      break;
    }
    case 'cooldowns': { // 새로고침하고 다시 들어왔다: 서버가 들고 있는 스킬·대시 쿨타임을 다시 보여 준다(welcome 뒤에 온다)
      const t0 = performance.now();
      setSkillCd(Object.fromEntries(Object.entries(m.skills).map(([id, ms]) => [normalizeSkillCode(id), t0 + ms])));
      if (m.dashReadyMs > 0) {
        setDash({ until: t0 + m.dashActiveMs, readyAt: t0 + m.dashReadyMs });
        if (m.dashActiveMs > 0) arena.startDash(m.dashActiveMs, m.dashMult);
      }
      break;
    }
    case 'loadout': { const slots = m.slots.map(normalizeSkillCode); setSlots(slots); setCurrentSlots(slots); break; } // 장착한 스킬 4칸(4.33)
    case 'skillFx': { // 누군가 스킬을 썼다: 그 연출(4.33)
      const fx = normalizeFxId(m);
      arena.showSkillFx(fx);
      // 내 쉴드는 내 체력 막대에도 롤처럼 흰 조각으로 붙는다(바깥 값은 최대 체력 대비 %)
      if ((fx.id === 'barrier' || fx.id === 'barrierHit') && fx.e === sess.myEntity) setMyHp((h) => ({ ...h, barrier: fx.pct }));
      else if (fx.id === 'barrierEnd' && fx.e === sess.myEntity) setMyHp((h) => ({ ...h, barrier: 0 }));
      // 켜고 끄는 스킬: 내 광폭화가 켜지면 스킬 칸에 돌아가는 노란 빛을 띄운다
      if (fx.id === 'berserk' && fx.e === sess.myEntity) setSkillOn((s) => (s.has('berserk') ? s : new Set(s).add('berserk')));
      else if (fx.id === 'berserkEnd' && fx.e === sess.myEntity) setSkillOn((s) => { if (!s.has('berserk')) return s; const n = new Set(s); n.delete('berserk'); return n; });
      break;
    }
    // 내가 스킬에 걸렸거나 풀렸다, 스킬을 쓰지 못했다(4.33): 묶음은 selfStatusMessages가 처리한다
    case 'skillFail': case 'dark': case 'darkEnd': case 'slow': case 'slowEnd': case 'confuse': case 'confuseEnd': case 'stun': case 'stunEnd': case 'pull': case 'pullEnd':
      handleSelfStatus(m, arena, skillLock, showToast, flashSkill); break;
    case 'dash': {
      // 대시 시작(4.27): 예측을 같은 속도로 올리고 아래 표시줄에 남은 시간·쿨타임을 보여 준다
      playSfx('dash');
      arena.startDash(m.ms, m.mult);
      const t = performance.now();
      setDash({ until: t + m.ms, readyAt: t + m.cooldownMs });
      break;
    }
  }
}

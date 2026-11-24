import { useCallback, useEffect, useState } from 'react';
import { api, ApiFailure } from '../api/client';
import type { Activity, ActivityRange, KeywordCard, PlayerSummary } from '../api/types';
import { ActivityChart } from './ActivityChart';
import { GeminiIcon } from './GeminiIcon';
import { Comments } from './Comments';
import { remaining, shortLeft, STATE_BADGE } from './keywordFormat';
import { Modal } from './Modal';
import { ReportDialog } from './ReportDialog';
import { successToast } from './toast';
import { fmtNumber, t } from '../i18n';

const RANGES: [ActivityRange, string][] = [['24h', t('chart.range24h')], ['7d', t('chart.range7d')], ['30d', t('chart.range30d')], ['180d', t('chart.range180d')]];
const HOLDERS_KEY = 'trendist.chartHolders';

interface Props {
  keywordId: number;
  onClose(): void;
  onPlused(gained: number, player: PlayerSummary): void;
  onError(message: string): void;
  /** 채팅으로 #키워드 공유(없으면 버튼을 숨긴다) */
  onShare?(text: string): void;
}

/** 제목 옆의 [공유]·[신고] 버튼. 창 제목줄에도, 합성 상세의 펼친 카드 위에도 같은 것을 쓴다 */
export function KeywordActions({ card, onShare, onReport }: { card: KeywordCard; onShare?(text: string): void; onReport(): void }) {
  const [shared, setShared] = useState(false); // 공유 직후 잠깐 버튼을 막는다(채팅은 1초에 1회)
  if (card.id === null) return null;
  return (
    <span className="kw-title-actions">
      {onShare && (
        <button className="kw-share" disabled={shared} title={t('keyword.shareTitle')} aria-label={t('keyword.shareAria', { text: card.text })}
                onClick={() => { onShare(card.text); setShared(true); window.setTimeout(() => setShared(false), 1500); }}>
          {shared ? t('keyword.shared') : t('keyword.share')}
        </button>
      )}
      <button className="kw-share kw-report" title={t('keyword.reportTitle')} onClick={onReport}>{t('keyword.report')}</button>
    </span>
  );
}

/**
 * 키워드 상세 카드(4.12). 키워드 이름이 보이는 곳(보관함, 검색 결과)에서 같은 창이 열린다.
 * 상태·트렌드 값·인원·추가수·검색수, 활동 그래프, 댓글을 보여 주고 바로 추가할 수 있다.
 */
export function KeywordModal({ keywordId, onClose, onPlused, onError, onShare }: Props) {
  const [card, setCard] = useState<KeywordCard | null>(null);
  const [reporting, setReporting] = useState(false); // 키워드 신고 창
  return (
    <Modal title={card?.text ?? t('keyword.title')} onClose={onClose} className="keyword-modal"
           titleExtra={card && <KeywordActions card={card} onShare={onShare} onReport={() => setReporting(true)} />}>
      <KeywordDetail keywordId={keywordId} onLoaded={setCard} onPlused={onPlused} onError={onError}
                     reporting={reporting} onReportClose={() => setReporting(false)} />
    </Modal>
  );
}

/** 상세 카드의 본문(창 밖에서도 쓴다: 합성 키워드 상세에서 구성 원본을 펼칠 때). onMissing: 키워드가 없어졌다(404) */
export function KeywordDetail({ keywordId, onLoaded, onPlused, onError, reporting, onReportClose, onMissing }: {
  keywordId: number;
  onLoaded?(card: KeywordCard): void;
  onPlused(gained: number, player: PlayerSummary): void;
  onError(message: string): void;
  reporting: boolean;
  onReportClose(): void;
  onMissing?(): void;
}) {
  const [card, setCard] = useState<KeywordCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<ActivityRange>('24h');
  const [activity, setActivity] = useState<Activity | null>(null);
  const [showHolders, setShowHolders] = useState(() => { try { return localStorage.getItem(HOLDERS_KEY) === '1'; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    api.keyword(keywordId).then((c) => { setCard(c); onLoaded?.(c); })
      .catch((e) => { if (e instanceof ApiFailure && e.status === 404 && onMissing) onMissing(); else setFailed(true); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywordId]);

  const loadActivity = useCallback(() => {
    api.activity(keywordId, range).then(setActivity).catch(() => setActivity(null));
  }, [keywordId, range]);

  // 이번 시간은 집계 중이라 창이 열려 있는 동안 1분마다 다시 읽는다
  useEffect(() => {
    loadActivity();
    const t = window.setInterval(loadActivity, 60_000);
    return () => clearInterval(t);
  }, [loadActivity]);

  useEffect(() => { try { localStorage.setItem(HOLDERS_KEY, showHolders ? '1' : '0'); } catch { /* 이 브라우저에만 기억 */ } }, [showHolders]);

  /** AI 설명이 맞지 않다고 갱신을 요청한다(4.12). 관리자가 먼저 확인한다 */
  async function requestAi() {
    if (!card || card.id === null || aiBusy || card.aiCommentRequested) return;
    setAiBusy(true);
    try {
      await api.requestAiComment(card.id);
      setCard((c) => (c ? { ...c, aiCommentRequested: true } : c));
      successToast(t('keyword.aiRequested'));
    } catch (err) {
      onError(err instanceof ApiFailure ? err.message : t('keyword.requestFailed'));
    } finally {
      setAiBusy(false);
    }
  }

  async function plus() {
    if (!card || busy) return;
    setBusy(true);
    try {
      const r = await api.plus(card.text);
      setCard(r.keyword);
      onPlused(r.gained, r.player);
      loadActivity();
    } catch (err) {
      onError(err instanceof ApiFailure ? err.message : t('keyword.plusFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (<>
      {failed && <p className="muted">{t('keyword.loadFailed')}</p>}
      {!failed && !card && <p className="muted">{t('common.loading')}</p>}
      {card && (<>
        {card.aiComment && (
          <section className="kw-ai" aria-label={t('keyword.aiLabel')}>
            <div className="kw-ai-head">
              <span className="kw-ai-label"><GeminiIcon /> {t('keyword.aiLabel')}</span>
              <button type="button" className="kw-ai-report" disabled={aiBusy || card.aiCommentRequested} onClick={requestAi}
                      title={t('keyword.aiReportTitle')}>
                {card.aiCommentRequested ? t('keyword.aiRequestedBtn') : t('keyword.aiReportBtn')}
              </button>
            </div>
            <p>{card.aiComment}</p>
          </section>
        )}
        <section className="kw-hero">
          <div className="kw-hero-main">
            <span className={`badge state-${card.state}`}>{STATE_BADGE[card.state] ?? card.state}</span>
            <div className="kw-score"><strong>{card.trendValue}</strong><span>{t('keyword.pointsUnit')}</span></div>
          </div>
          <div className="kw-hero-side">
            {card.plusedByMe && card.myExpiresAt && <HoldGauge expiresAt={card.myExpiresAt} />}
            <button className={card.plusedByMe ? 'kw-plus held' : 'primary kw-plus'} onClick={plus} disabled={busy || card.plusedByMe}
                    aria-label={card.plusedByMe ? t('keyword.alreadyHeld') : t('keyword.addAria', { text: card.text })}>
              {card.plusedByMe ? t('keyword.held') : t('keyword.add')}
            </button>
          </div>
        </section>

        <dl className="kw-stats">
          <div><dt>{t('keyword.holders')}</dt><dd>{t('keyword.holderCount', { n: fmtNumber(card.holderCount) })}</dd></div>
          <div><dt>{t('keyword.adds')}</dt><dd>{fmtNumber(card.addCount)}</dd></div>
          <div><dt>{t('keyword.searches')}</dt><dd>{fmtNumber(card.searchCount)}</dd></div>
          <div><dt>{t('keyword.views')}</dt><dd>{fmtNumber(card.viewCount)}</dd></div>
        </dl>

        <section className="kw-activity" aria-label={t('keyword.activityGraph')}>
          <div className="kw-activity-head">
            <h3>{t('keyword.activity')}</h3>
            <div className="chip-row" role="group" aria-label={t('keyword.period')}>
              {RANGES.map(([r, label]) => (
                <button key={r} className={range === r ? 'chip active' : 'chip'} aria-pressed={range === r} onClick={() => setRange(r)}>{label}</button>
              ))}
            </div>
            <label className="toggle small">
              <input type="checkbox" checked={showHolders} onChange={(e) => setShowHolders(e.target.checked)} /> {t('keyword.holders')}
            </label>
          </div>
          {activity && activity.range === range ? <ActivityChart activity={activity} showHolders={showHolders} />
            : <div className="chart-placeholder muted small">{t('chart.loading')}</div>}
        </section>

        <Comments keywordId={keywordId} onError={onError} />
        {reporting && card.id !== null && (
          <ReportDialog target="KEYWORD" targetId={card.id} preview={t('keyword.reportPreview', { text: card.text })}
                        onClose={onReportClose} onDone={(err) => { onReportClose(); if (err) onError(err); }} />
        )}
      </>)}
  </>);
}


/**
 * 내가 가진 키워드의 남은 시간(보관함 카드와 같은 모양): 게이지(24시간 기준)와 오른쪽 끝의 `23h 남음` / `32m 남음`.
 * 절반 아래는 주황, 1시간 아래는 빨강. 30초마다 다시 계산한다.
 */
export function HoldGauge({ expiresAt }: { expiresAt: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick((n) => n + 1), 30_000); return () => window.clearInterval(id); }, []);
  const left = new Date(expiresAt).getTime() - Date.now();
  const ratio = Math.max(0, Math.min(1, left / (24 * 3_600_000)));
  const tone = left < 3_600_000 ? 'urgent' : ratio < 0.5 ? 'mid' : 'ok';
  const lf = shortLeft(expiresAt);
  return (
    <div className={`kw-hold ${tone}`} title={remaining(expiresAt)}>
      <div className="kw-hold-gauge" role="presentation"><i style={{ width: `${(ratio * 100).toFixed(1)}%` }} /></div>
      <span className={left < 3_600_000 ? 'kw-hold-left warn' : 'kw-hold-left'}>{lf.n}{lf.unit} {t('side.leftSuffix')}</span>
    </div>
  );
}

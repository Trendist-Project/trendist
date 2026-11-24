import { useCallback, useEffect, useState } from 'react';
import { api, ApiFailure } from '../api/client';
import type { Activity, ActivityRange, KeywordCard, MergedDetail, PlayerSummary } from '../api/types';
import { ActivityChart } from './ActivityChart';
import { GeminiIcon } from './GeminiIcon';
import { KeywordActions, KeywordDetail } from './KeywordModal';
import { remaining, STATE_BADGE } from './keywordFormat';
import { partsSum, starLabel } from './mergeFormat';
import { Modal } from './Modal';
import { fmtNumber, t } from '../i18n';

const RANGES: [ActivityRange, string][] = [['24h', t('chart.range24h')], ['7d', t('chart.range7d')], ['30d', t('chart.range30d')], ['180d', t('chart.range180d')]];
const FOLD_OVER = 3; // 구성이 이보다 많으면 처음에는 접어 둔다

interface Props {
  keywordId: number;
  onClose(): void;
  onPlused(gained: number, player: PlayerSummary): void;
  onError(message: string): void;
  onShare?(text: string): void;
}

/**
 * 합성 키워드 상세 창(4.44). 일반 키워드 상세(4.12)와 별개의 전용 창이다.
 * 맨 위 요약(이름·★·점수 산식·남은 시간), 구성 원본 전체의 통합 활동 그래프, 구성 키워드 카드 목록,
 * 카드마다 [자세히 ▾]로 그 자리에서 일반 상세 카드(개별 그래프·댓글·신고·공유)를 펼친다.
 */
export function MergedKeywordModal({ keywordId, onClose, onPlused, onError, onShare }: Props) {
  const [detail, setDetail] = useState<MergedDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<ActivityRange>('24h');
  const [activity, setActivity] = useState<Activity | null>(null);
  const [showHolders, setShowHolders] = useState(false);

  // 구성 원본이 빠져 성이 바뀌었거나 합성 키워드가 사라졌다: 창을 닫고 알린다
  const gone = useCallback(() => { onClose(); onError(t('merge.gone')); }, [onClose, onError]);

  useEffect(() => {
    let alive = true;
    api.mergedDetail(keywordId).then((d) => { if (alive) setDetail(d); })
      .catch((e) => { if (!alive) return; if (e instanceof ApiFailure && e.status === 404) gone(); else setFailed(true); });
    return () => { alive = false; };
  }, [keywordId, gone]);

  const loadActivity = useCallback(() => {
    api.mergedActivity(keywordId, range).then(setActivity)
      .catch((e) => { if (e instanceof ApiFailure && e.status === 404) gone(); else setActivity(null); });
  }, [keywordId, range, gone]);

  // 이번 시간은 집계 중이라 창이 열려 있는 동안 1분마다 다시 읽는다
  useEffect(() => {
    loadActivity();
    const id = window.setInterval(loadActivity, 60_000);
    return () => clearInterval(id);
  }, [loadActivity]);

  const holdersSum = detail ? detail.parts.reduce((n, p) => n + p.holderCount, 0) : 0;
  // 점수 산식: 구성 원본 점수의 합 × 배율. 💤 원본은 0점으로 보인다
  const partScore = (p: KeywordCard) => (p.state === '활성' ? p.trendValue : 0);
  const formulaParts = detail ? partsSum(detail.parts.map((p) => ({ text: p.text, trendValue: partScore(p) }))) : '';

  return (
    <Modal title={detail ? `${starLabel(detail.stars)} ${detail.text}`.trim() : t('merge.detailTitle')} onClose={onClose} className="keyword-modal merged-modal">
      {failed && <p className="muted">{t('merge.loadFailed')}</p>}
      {!failed && !detail && <p className="muted">{t('common.loading')}</p>}
      {detail && (<>
        <section className="kw-hero merged-hero">
          <div className="kw-hero-main">
            <span className="badge merge-badge" aria-label={t('merge.starsAria', { n: detail.stars })}>{starLabel(detail.stars)} {t('merge.detailTitle')}</span>
            <div className="kw-score"><strong>{fmtNumber(detail.trendValue)}</strong><span>{t('keyword.pointsUnit')}</span></div>
            <p className="muted small merged-formula">{t('merge.scoreFormula', { parts: formulaParts, mult: detail.multiplier, score: fmtNumber(detail.trendValue) })}</p>
          </div>
          <div className="kw-hero-side">
            {detail.myExpiresAt && <span className="muted small">{remaining(detail.myExpiresAt)}</span>}
          </div>
        </section>

        <dl className="kw-stats merged-stats">
          <div><dt>{t('merge.partCount')}</dt><dd>{t('merge.partCountValue', { n: detail.parts.length })}</dd></div>
          <div><dt>{t('merge.holdersSum')}</dt><dd>{t('merge.holdersValue', { n: fmtNumber(holdersSum) })}</dd></div>
        </dl>

        <section className="kw-activity" aria-label={t('merge.activity')}>
          <div className="kw-activity-head">
            <h3>{t('merge.activity')}</h3>
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
            : <div className="chart-placeholder muted small">{t('merge.chartLoading')}</div>}
          <p className="muted small">{t('merge.activityNote')}</p>
        </section>

        <section className="merged-parts" aria-label={t('merge.partsTitle')}>
          <h3>{t('merge.partsTitle')}</h3>
          <ul className="merged-part-list">
            {detail.parts.map((p) => (
              <PartCard key={p.id ?? p.text} card={p} startOpen={detail.parts.length <= FOLD_OVER}
                        onPlused={onPlused} onError={onError} onShare={onShare} onMissing={gone} />
            ))}
          </ul>
        </section>
      </>)}
    </Modal>
  );
}

/** 구성 원본 한 개: 이름·상태·점수 한 줄 요약, 펼치면 AI 설명·인원·추가수·검색수, [자세히 ▾]로 일반 상세 카드 */
function PartCard({ card, startOpen, onPlused, onError, onShare, onMissing }: {
  card: KeywordCard; startOpen: boolean;
  onPlused(gained: number, player: PlayerSummary): void; onError(message: string): void; onShare?(text: string): void; onMissing(): void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [detail, setDetail] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [full, setFull] = useState<KeywordCard | null>(null); // 자세히를 펼친 뒤의 최신 카드(공유·신고 버튼용)
  const inactive = card.state === '비활성';
  return (
    <li className={`merged-part${inactive ? ' inactive' : ''}`}>
      <div className="merged-part-head">
        <button className="merged-part-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)} title={open ? t('merge.partFold') : t('merge.partToggle')}>
          <strong>{card.text}</strong> <span className={`badge state-${card.state}`}>{STATE_BADGE[card.state] ?? card.state}</span>
          <span className="mine-score">{t('side.points', { n: fmtNumber(inactive ? 0 : card.trendValue) })}</span>
          <span aria-hidden="true" className="merged-part-caret">{open ? '▴' : '▾'}</span>
        </button>
      </div>
      {open && (
        <div className="merged-part-body">
          {card.aiComment
            ? <p className="merged-part-ai"><GeminiIcon /> {card.aiComment}</p>
            : <p className="muted small">{t('merge.noAi')}</p>}
          <p className="muted small merged-part-stats">
            {t('keyword.holders')} {fmtNumber(card.holderCount)} · {t('keyword.adds')} {fmtNumber(card.addCount)} · {t('keyword.searches')} {fmtNumber(card.searchCount)}
          </p>
          {inactive && <p className="merged-part-note">💤 {t('merge.inactiveNote')}</p>}
          <div className="merged-part-actions">
            <button className="chip" aria-expanded={detail} aria-label={t('merge.partDetailAria', { text: card.text })} onClick={() => setDetail((v) => !v)}>
              {detail ? t('merge.detailClose') : t('merge.detailOpen')}
            </button>
            {detail && full && <KeywordActions card={full} onShare={onShare} onReport={() => setReporting(true)} />}
          </div>
          {detail && card.id !== null && (
            <div className="merged-part-detail">
              {/* 개별 카드를 펼친 때만 그 원본의 조회수가 센다 */}
              <KeywordDetail keywordId={card.id} onLoaded={setFull} onPlused={onPlused} onError={onError}
                             reporting={reporting} onReportClose={() => setReporting(false)} onMissing={onMissing} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

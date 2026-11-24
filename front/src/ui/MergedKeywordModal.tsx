import { useCallback, useEffect, useState } from 'react';
import { api, ApiFailure } from '../api/client';
import type { Activity, ActivityRange, KeywordCard, MergedDetail, PlayerSummary } from '../api/types';
import { ActivityChart } from './ActivityChart';
import { GeminiIcon } from './GeminiIcon';
import { HoldGauge, KeywordActions, KeywordDetail } from './KeywordModal';
import { STATE_BADGE } from './keywordFormat';
import { DEFAULT_GRADE_MINS, tierOf } from './mergeFormat';
import { Modal } from './Modal';
import { fmtNumber, t } from '../i18n';

const RANGES: [ActivityRange, string][] = [['24h', t('chart.range24h')], ['7d', t('chart.range7d')], ['30d', t('chart.range30d')], ['180d', t('chart.range180d')]];
const SEG_COLORS = ['#4aa8ff', '#ffb454', '#7bd88f', '#c792ea', '#ff7a90', '#5ad1c8', '#f0e060', '#b0b8c8']; // 점수 구성 막대의 구성 원본별 색

interface Props {
  keywordId: number;
  onClose(): void;
  onPlused(gained: number, player: PlayerSummary): void;
  onError(message: string): void;
  onShare?(text: string): void;
  /** 합성 키워드 공유: 구성 원본 이름들을 채팅에 #키워드1 #키워드2 … 한 줄로 보낸다 */
  onShareParts?(texts: string[]): void;
}

/**
 * 합성 키워드 상세 창(4.44). 일반 키워드 상세(4.12)와 별개의 전용 창이다.
 * 맨 위 요약(이름·★·점수 산식·남은 시간), 구성 원본 전체의 통합 활동 그래프, 구성 키워드 카드 목록,
 * 카드마다 [자세히 ▾]로 그 자리에서 일반 상세 카드(개별 그래프·댓글·신고·공유)를 펼친다.
 */
export function MergedKeywordModal({ keywordId, onClose, onPlused, onError, onShare, onShareParts }: Props) {
  const [shared, setShared] = useState(false); // 공유 직후 잠깐 버튼을 막는다(채팅은 1초에 1회)
  const [detail, setDetail] = useState<MergedDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<ActivityRange>('24h');
  const [activity, setActivity] = useState<Activity | null>(null);
  const [showHolders, setShowHolders] = useState(false);
  // 활동 그래프: 넓고 높은 화면에서만 처음부터 펼친다(좁은 폰에서는 접어 두어 팝업이 화면을 넘지 않게). 접혀 있는 동안은 불러오지도 않는다
  const [chartOpen, setChartOpen] = useState(() => { try { return window.matchMedia('(min-width: 761px) and (min-height: 720px)').matches; } catch { return true; } });
  const narrow = (() => { try { return window.matchMedia('(max-width: 760px), (max-height: 600px)').matches; } catch { return false; } })();
  const [mins, setMins] = useState<number[]>(DEFAULT_GRADE_MINS); // 등급 기준(4.42): 보관함 카드와 같은 색·이름을 쓴다
  useEffect(() => { api.keywordGrades().then((g) => { if (Array.isArray(g.mins) && g.mins.length === 5) setMins(g.mins); }).catch(() => { /* 기본 기준 */ }); }, []);

  // 구성 원본이 빠져 성이 바뀌었거나 합성 키워드가 사라졌다: 창을 닫고 알린다
  const gone = useCallback(() => { onClose(); onError(t('merge.gone')); }, [onClose, onError]);

  useEffect(() => {
    let alive = true;
    api.mergedDetail(keywordId).then((d) => { if (alive) setDetail(d); })
      .catch((e) => { if (!alive) return; if (e instanceof ApiFailure && e.status === 404) gone(); else setFailed(true); });
    return () => { alive = false; };
  }, [keywordId, gone]);

  const loadActivity = useCallback(() => {
    if (!chartOpen) return;
    api.mergedActivity(keywordId, range).then(setActivity)
      .catch((e) => { if (e instanceof ApiFailure && e.status === 404) gone(); else setActivity(null); });
  }, [keywordId, range, gone, chartOpen]);

  // 이번 시간은 집계 중이라 창이 열려 있는 동안 1분마다 다시 읽는다
  useEffect(() => {
    loadActivity();
    const id = window.setInterval(loadActivity, 60_000);
    return () => clearInterval(id);
  }, [loadActivity]);

  const holdersSum = detail ? detail.parts.reduce((n, p) => n + p.holderCount, 0) : 0;
  // 점수 구성: 구성 원본 점수의 합 × 별 개수. 💤 원본은 0점으로 보인다
  const partScore = (p: KeywordCard) => (p.state === '활성' ? p.trendValue : 0);
  const partsTotal = detail ? detail.parts.reduce((n, p) => n + partScore(p), 0) : 0;
  const tier = detail ? tierOf(detail.trendValue, mins) : 0;

  return (
    <Modal title={detail ? detail.text : t('merge.detailTitle')} onClose={onClose} className="keyword-modal merged-modal"
           titleExtra={detail && onShareParts && detail.parts.length > 0 && (
             <span className="kw-title-actions">
               <button className="kw-share" disabled={shared} title={t('merge.shareTitle')} aria-label={t('merge.shareAria', { text: detail.text })}
                       onClick={() => { onShareParts(detail.parts.map((p) => p.text)); setShared(true); window.setTimeout(() => setShared(false), 1500); }}>
                 {shared ? t('keyword.shared') : t('keyword.share')}
               </button>
             </span>
           )}>
      {failed && <p className="muted">{t('merge.loadFailed')}</p>}
      {!failed && !detail && <p className="muted">{t('common.loading')}</p>}
      {detail && (<>
        {/* ① 등급·성·남은 시간 → ② 점수(크게) → ③ 점수가 어떻게 나왔는지(구성 기여도 막대와 범례, 구성 합 옆에 × 별 개수) */}
        <section className={`kw-hero merged-hero grade-t${tier}`}>
          <div className="merged-hero-top">
            <span className="merged-grade">{t(`side.tier${tier}`)}</span>
            <span className="merged-stars" role="img" aria-label={t('merge.starsAria', { n: detail.stars })}>
              {'★'.repeat(Math.min(detail.stars, 8))}{detail.stars > 8 ? `×${detail.stars}` : ''}
            </span>
          </div>
          <div className="merged-score-row">
            <div className="kw-score"><strong>{fmtNumber(detail.trendValue)}</strong><span>{t('keyword.pointsUnit')}</span></div>
          </div>
          <div className="merged-breakdown" aria-label={t('merge.breakdown')}>
            <div className="merged-bar" role="presentation">
              {detail.parts.map((p, i) => {
                const v = partScore(p);
                if (v <= 0) return null;
                return <i key={p.id ?? p.text} style={{ flexGrow: v, background: SEG_COLORS[i % SEG_COLORS.length] }} title={`${p.text} ${fmtNumber(v)}`} />;
              })}
            </div>
            <ul className="merged-legend">
              {detail.parts.map((p, i) => (
                <li key={p.id ?? p.text} className={partScore(p) === 0 ? 'zero' : undefined}>
                  <i style={{ background: SEG_COLORS[i % SEG_COLORS.length] }} />{p.text} <b>{fmtNumber(partScore(p))}</b>
                </li>
              ))}
              <li className="sum">
                {detail.myExpiresAt ? <span className="merged-hold"><HoldGauge expiresAt={detail.myExpiresAt} /></span> : <span />}
                <span className="merged-sum-formula">{t('merge.partsSumLabel')} <b>{fmtNumber(partsTotal)}</b>
                  <span className="merged-mult" title={t('merge.multiplierChip', { mult: detail.multiplier })} aria-label={t('merge.multiplierChip', { mult: detail.multiplier })}>
                    × <svg className="merged-mult-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.94 6.1 6.56.9-4.78 4.6 1.2 6.6L12 17.5l-5.92 3.2 1.2-6.6L2.5 9.5l6.56-.9z" /></svg>({detail.multiplier})
                  </span>
                </span>
              </li>
            </ul>
          </div>
        </section>

        <div className="merged-meta">
          <span>{t('merge.partCount')} <b>{t('merge.partCountValue', { n: detail.parts.length })}</b></span>
          <span>👥 {t('merge.holdersSum')} <b>{t('merge.holdersValue', { n: fmtNumber(holdersSum) })}</b></span>
        </div>

        <section className="kw-activity" aria-label={t('merge.activity')}>
          <div className="kw-activity-head">
            <button type="button" className="kw-activity-toggle" aria-expanded={chartOpen} onClick={() => setChartOpen((v) => !v)}>
              <h3>{t('merge.activity')}</h3><span aria-hidden="true">{chartOpen ? '▴' : '▾'}</span>
            </button>
            {chartOpen && (<>
              <div className="chip-row" role="group" aria-label={t('keyword.period')}>
                {RANGES.map(([r, label]) => (
                  <button key={r} className={range === r ? 'chip active' : 'chip'} aria-pressed={range === r} onClick={() => setRange(r)}>{label}</button>
                ))}
              </div>
              <label className="toggle small">
                <input type="checkbox" checked={showHolders} onChange={(e) => setShowHolders(e.target.checked)} /> {t('keyword.holders')}
              </label>
            </>)}
          </div>
          {chartOpen && (<>
            {activity && activity.range === range ? <ActivityChart activity={activity} showHolders={showHolders} height={narrow ? 150 : undefined} />
              : <div className="chart-placeholder muted small">{t('merge.chartLoading')}</div>}
            <p className="muted small">{t('merge.activityNote')}</p>
          </>)}
        </section>

        <section className="merged-parts" aria-label={t('merge.partsTitle')}>
          <h3>{t('merge.partsTitle')}</h3>
          <ul className="merged-part-list">
            {detail.parts.map((p) => (
              <PartCard key={p.id ?? p.text} card={p} onPlused={onPlused} onError={onError} onShare={onShare} onMissing={gone} />
            ))}
          </ul>
        </section>
      </>)}
    </Modal>
  );
}

/**
 * 구성 원본 한 개(접힌 한 줄): 이름 · 상태 태그 · 점수 태그 · ✦ AI 한 줄 설명(넘치면 …). 누르면 그 자리에서 키워드 상세 전체(AI 설명·통계·그래프·댓글)가 펼쳐진다.
 * 요약을 따로 두지 않아 같은 정보가 두 번 나오지 않는다.
 */
function PartCard({ card, onPlused, onError, onShare, onMissing }: {
  card: KeywordCard;
  onPlused(gained: number, player: PlayerSummary): void; onError(message: string): void; onShare?(text: string): void; onMissing(): void;
}) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [full, setFull] = useState<KeywordCard | null>(null); // 펼친 뒤의 최신 카드(공유·신고 버튼용)
  const inactive = card.state === '비활성';
  return (
    <li className={`merged-part${inactive ? ' inactive' : ''}${open ? ' open' : ''}`}>
      <div className="merged-part-head">
        <button className="merged-part-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}
                aria-label={t('merge.partDetailAria', { text: card.text })} title={open ? t('merge.partFold') : t('merge.partToggle')}>
          <strong className="merged-part-name" title={card.text}>{card.text}</strong>
          {/* 접힌 동안만 상태·점수 태그와 AI 한 줄 설명을 보인다: 펼치면 상세 안에 같은 정보가 있어 중복되지 않게 이름 옆을 비우고 [공유]·[신고]를 붙인다 */}
          {!open && (<>
            <span className={`badge state-${card.state}`}>{STATE_BADGE[card.state] ?? card.state}</span>
            <span className="mine-score">{t('side.points', { n: fmtNumber(inactive ? 0 : card.trendValue) })}</span>
            <span className="merged-part-ai-line" title={card.aiComment ?? undefined}>
              {card.aiComment ? <><GeminiIcon /><span className="merged-part-ai-text">{card.aiComment}</span></> : <span className="muted merged-part-ai-text">{t('merge.noAi')}</span>}
            </span>
          </>)}
        </button>
        {/* 펼치면 일반 키워드 상세 창처럼 키워드 바로 옆(같은 줄)에 [공유]·[신고] */}
        {open && card.id !== null && <KeywordActions card={full ?? card} onShare={onShare} onReport={() => setReporting(true)} />}
        {open && <span className="merged-part-fill" aria-hidden="true" />}
        {/* 펼치기·접기 화살표는 펼치기 전과 같은 오른쪽 끝 자리에 둔다 */}
        <button type="button" className="merged-part-caret" tabIndex={-1} aria-hidden="true" onClick={() => setOpen((v) => !v)}>{open ? '▴' : '▾'}</button>
      </div>
      {open && card.id !== null && (
        <div className="merged-part-detail">
          {/* 펼친 때만 그 원본의 조회수가 센다 */}
          <KeywordDetail keywordId={card.id} onLoaded={setFull} onPlused={onPlused} onError={onError}
                         reporting={reporting} onReportClose={() => setReporting(false)} onMissing={onMissing} />
        </div>
      )}
    </li>
  );
}

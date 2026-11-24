import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { playSfx } from '../game/sound';

/** 첫 입장 튜토리얼(4.43): 이동 → 키워드 추가 → 부딪히기 3단계. 끝내거나 건너뛰면 이 브라우저에 기억하고 다시 보이지 않는다 */
const KEY = 'trendist.tutorial';
export function tutorialDone() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
export function markTutorialDone() { try { localStorage.setItem(KEY, '1'); } catch { /* 무시 */ } }

export type TutorialEvent = 'plus' | 'fight';
export interface TutorialApi { event: (e: TutorialEvent) => void }

interface Props {
  /** 내 원의 지금 위치(움직였는지 보려고) */
  position: () => { x: number; y: number } | null;
  /** 검색 시트·패널을 연다 */
  onOpenSearch: () => void;
  onClose: () => void;
  /** 부모가 plus·fight 사건을 알릴 때 쓸 함수를 받아 간다 */
  bind: (api: TutorialApi) => void;
}

const MOVE_PX = 140;

export function Tutorial({ position, onOpenSearch, onClose, bind }: Props) {
  const [step, setStep] = useState(1);
  const [finished, setFinished] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const stepRef = useRef(1);
  stepRef.current = step;

  const go = (n: number) => { stepRef.current = n; setStep(n); };
  useEffect(() => {
    bind({ event: (e) => { if (e === 'plus' && stepRef.current === 2) go(3); else if (e === 'fight' && stepRef.current === 3) go(4); } });
  }, [bind]);
  useEffect(() => { // 1단계: 처음 자리에서 멀어지면 다음으로
    if (step !== 1) return;
    const id = window.setInterval(() => {
      const p = position(); if (!p) return;
      if (!start.current) { start.current = p; return; }
      if (Math.hypot(p.x - start.current.x, p.y - start.current.y) >= MOVE_PX) go(2);
    }, 250);
    return () => window.clearInterval(id);
  }, [step, position]);
  useEffect(() => { // 끝: 축하하고 잠시 뒤 닫는다
    if (step < 4) return;
    setFinished(true); playSfx('levelup'); markTutorialDone();
    const id = window.setTimeout(onClose, 3500);
    return () => window.clearTimeout(id);
  }, [step, onClose]);

  const skip = () => { markTutorialDone(); onClose(); };
  return (
    <aside className={`tutorial${finished ? ' done' : ''}`} role="status" aria-live="polite">
      {finished ? <strong>{t('tutorial.done')}</strong> : (<>
        <div className="tutorial-head">
          <span className="tutorial-dots" aria-hidden="true">{[1, 2, 3].map((n) => <i key={n} className={n < step ? 'done' : n === step ? 'now' : ''} />)}</span>
          <strong>{t(`tutorial.step${step}`)}</strong>
          <button type="button" className="tutorial-skip" onClick={skip}>{t('tutorial.skip')}</button>
        </div>
        <p>{t(`tutorial.step${step}Desc`)}</p>
        {step === 2 && <button type="button" className="tutorial-go" onClick={onOpenSearch}>{t('tutorial.openSearch')}</button>}
      </>)}
    </aside>
  );
}

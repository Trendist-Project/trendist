import { useEffect, useRef } from 'react';
import type { LevelBadge } from '../api/types';
import { drawTurtle } from '../game/turtle';
import { paintBase } from '../game/levelBadges';
import { t } from '../i18n';

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SIZE = 56; // 아이콘 하나의 CSS 크기(px)

/** 가이드용(4.9, 4.17): 1~10레벨 성장 아이콘을 아레나와 같은 그림으로 나란히 보여 준다. */
export function GrowthIcons() {
  return (
    <figure className="growth-icons" aria-label={t('guideArt.growthAria')}>
      <ol>
        {LEVELS.map((lv) => (
          <li key={lv}>
            <TurtleIcon level={lv} />
            <span>{t('common.levelPrefix')}{lv}{t('common.levelSuffix')}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/**
 * 성장 아이콘 한 개(아레나와 같은 그림). 가이드와 정보 팝업이 쓴다.
 * badge가 있으면 바탕을 그 색·진하기로(rainbow면 무지개 그라데이션) 칠한다. 레벨 표시 옆 아이콘용(4.9).
 */
export function TurtleIcon({ level, size = SIZE, badge }: { level: number; size?: number; badge?: LevelBadge | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr; canvas.height = size * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const c = size / 2, r = size / 2 - 3;
    // 아레나의 아이콘과 같은 순서: 바탕 원 → 거북이 → 테두리
    paintBase(ctx, c, c, r, badge ?? null);
    drawTurtle(ctx, c, c, r, level);
    ctx.strokeStyle = '#11372a';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
  }, [level, size, badge]);
  return <canvas ref={ref} style={{ width: size, height: size, flex: 'none' }} aria-hidden="true" />;
}

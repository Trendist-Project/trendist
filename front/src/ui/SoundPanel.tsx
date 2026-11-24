import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { Modal } from './Modal';
import { playSfx, resetVolumes, setBgm, setSfx, setVolume, soundState, subscribeSound, type VolumeKind } from '../game/sound';

/**
 * 소리 설정(4.39): 마스터 음량, 효과음, 배경음을 한 창에 모았다. 음량은 0~100이고 효과음·배경음은 각각 켜고 끌 수 있다.
 * 모두 이 브라우저에 기억한다. 효과음 슬라이더를 놓으면 샘플이 한 번 울려 크기를 바로 알 수 있다.
 */
export function SoundPanel({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState(soundState);
  useEffect(() => subscribeSound(() => setS(soundState())), []);

  const slider = (kind: VolumeKind, value: number, name: string, disabled = false) => (
    <div className="snd-slider">
      <input type="range" min={0} max={100} step={1} value={value} disabled={disabled} aria-label={t('sound.volume', { name })}
             style={{ ['--fill' as string]: `${value}%` }}
             onChange={(e) => setVolume(kind, Number(e.target.value))}
             onPointerUp={() => { if (kind !== 'bgm') playSfx('gain'); }} onKeyUp={() => { if (kind !== 'bgm') playSfx('gain'); }} />
      <output>{value}</output>
    </div>
  );

  return (
    <Modal title={t('sound.title')} onClose={onClose} className="sound-modal">
      <div className="snd-row master">
        <div className="snd-head"><strong>🔊 {t('sound.master')}</strong><span className="muted small">{t('sound.masterDesc')}</span></div>
        {slider('master', s.master, t('sound.master'))}
        {s.master === 0 && <p className="snd-hint warn small">{t('sound.mutedHint')}</p>}
      </div>

      <div className={`snd-row${s.sfx ? '' : ' off'}`}>
        <div className="snd-head">
          <div><strong>🎯 {t('sound.sfx')}</strong><span className="muted small">{t('sound.sfxDesc')}</span></div>
          <button type="button" className={`snd-switch${s.sfx ? ' on' : ''}`} role="switch" aria-checked={s.sfx} onClick={() => setSfx(!s.sfx)}
                  aria-label={t('sound.sfx')}>{s.sfx ? t('sound.on') : t('sound.off')}</button>
        </div>
        {slider('sfx', s.sfxVol, t('sound.sfx'), !s.sfx)}
        <button type="button" className="snd-test" disabled={!s.sfx} onClick={() => playSfx('kill')}>▶ {t('sound.test')}</button>
      </div>

      <div className={`snd-row${s.bgm ? '' : ' off'}`}>
        <div className="snd-head">
          <div><strong>🎵 {t('sound.bgm')}</strong><span className="muted small">{t('sound.bgmDesc')}</span></div>
          <button type="button" className={`snd-switch${s.bgm ? ' on' : ''}`} role="switch" aria-checked={s.bgm} onClick={() => setBgm(!s.bgm)}
                  aria-label={t('sound.bgm')}>{s.bgm ? t('sound.on') : t('sound.off')}</button>
        </div>
        {slider('bgm', s.bgmVol, t('sound.bgm'), !s.bgm)}
      </div>

      <p className="muted small snd-note">{t('sound.autoplayHint')}</p>
      <button type="button" className="snd-reset" onClick={resetVolumes}>{t('sound.reset')}</button>
    </Modal>
  );
}

import { publicText } from '../public-text';
import { ShareSheetBody } from './share-sheet-body';
import { ShareSheetTimed } from './share-sheet-timed';
import { SHARE_STEPS, type ShareStep } from './share-steps';

export { SHARE_STEPS, ShareSheetBody, type ShareStep };

const STEP_NUMBERS: readonly ShareStep[] = [0, 1, 2, 3, 4];

export interface ShareSheetProps {
  /**
   * `scroll` follows the scene around it (five steps, the finished one is `Access Ended`);
   * `timed` plays the five steps by itself every 2.2 seconds, for every visitor (gentle fades with
   * reduced motion), only while on screen, with a Pause button; without JavaScript it rests finished.
   */
  readonly mode: 'scroll' | 'timed';
  /** Pins one step as a still picture (no scene, no timer). */
  readonly step?: ShareStep;
  readonly pageLang?: string;
}

export function ShareSheet({ mode, step, pageLang = 'en' }: ShareSheetProps) {
  if (step !== undefined) return <ShareSheetBody step={step} pageLang={pageLang} />;
  if (mode === 'timed')
    return (
      <ShareSheetTimed
        bodies={STEP_NUMBERS.map((number) => (
          <ShareSheetBody key={number} step={number} pageLang={pageLang} />
        ))}
        playLabel={publicText('Play the Animation', pageLang)}
        pauseLabel={publicText('Pause the Animation', pageLang)}
      />
    );
  return <ShareSheetBody pageLang={pageLang} />;
}

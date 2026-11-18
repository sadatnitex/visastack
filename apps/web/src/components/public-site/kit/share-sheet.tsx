import { ShareSheetBody, type ShareStep } from './share-sheet-body';
import { ShareSheetTimed } from './share-sheet-timed';

export { SHARE_STEPS, ShareSheetBody, type ShareStep } from './share-sheet-body';

export interface ShareSheetProps {
  /**
   * `scroll` follows the scene around it (five steps, the finished one is `Access Ended`);
   * `timed` plays the five steps by itself every 2.2 seconds, and rests finished with reduced
   * motion or data saver.
   */
  readonly mode: 'scroll' | 'timed';
  /** Pins one step as a still picture (no scene, no timer). */
  readonly step?: ShareStep;
  readonly pageLang?: string;
}

export function ShareSheet({ mode, step, pageLang = 'en' }: ShareSheetProps) {
  if (step !== undefined) return <ShareSheetBody step={step} pageLang={pageLang} />;
  if (mode === 'timed') return <ShareSheetTimed pageLang={pageLang} />;
  return <ShareSheetBody pageLang={pageLang} />;
}

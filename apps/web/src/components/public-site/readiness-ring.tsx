import { progressRingPercent } from '../../lib/readiness-words';
import { ProgressRing } from '../progress-ring';
import { publicText } from './public-text';
import './public-site.css';

/** Readiness is completeness, never approval: the ring always says so beside it. */
export const READINESS_NOTE = 'Completeness only. Not an approval.';

export interface ReadinessRingProps {
  readonly done: number;
  readonly total: number;
  readonly size?: 'sm' | 'md' | 'lg';
  /** What is counted, in Title Case (for example "Documents Ready"). */
  readonly countLabel?: string;
  readonly pageLang?: string;
}

/** The product's progress ring, as the public site shows it. */
export function ReadinessRing({
  done,
  total,
  size = 'lg',
  countLabel,
  pageLang = 'en',
}: ReadinessRingProps) {
  return (
    <span className="pub-readiness">
      <ProgressRing
        done={done}
        total={total}
        size={size}
        {...(total > 0 ? { centre: `${progressRingPercent(done, total)}%` } : {})}
        {...(countLabel ? { countLabel } : {})}
      />
      <span className="pub-readiness-note">{publicText(READINESS_NOTE, pageLang)}</span>
    </span>
  );
}

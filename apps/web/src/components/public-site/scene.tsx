import type { ReactNode } from 'react';
import './public-site.css';
import './public-scenes.css';

/** A scroll scene's length, in screen heights, while scenes move (1 to 4). */
export type SceneLength = 1 | 1.5 | 2 | 2.5 | 3 | 4;

export interface SceneProps {
  /** A short name for the scene, unique on the page (for example "hero"). */
  readonly name: string;
  /** Screen heights the scene takes while it moves. */
  readonly len: SceneLength;
  /** How many steps the scene shows, at least 1. */
  readonly steps: number;
  /** The step shown without motion (no JavaScript, reduced motion, data saver). Default: the last. */
  readonly finalStep?: number;
  /** The heading that names the scene. */
  readonly labelledBy?: string;
  /**
   * The narrowest screen, in CSS pixels, on which this scene is pinned and moves (R1: Home uses 900).
   * Between the engine's own floor and this width the scene is an ordinary finished section.
   */
  readonly minWidth?: 900;
  readonly className?: string;
  readonly children: ReactNode;
}

function whole(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : min;
}

/** A scroll length in half screens, from 1 to 4 (R1: a scene may take 1.5 or 2.5 screens). */
function halves(value: number): number {
  return Number.isFinite(value) ? Math.min(4, Math.max(1, Math.round(value * 2) / 2)) : 1;
}

/**
 * One scroll scene. The server writes the finished step, so the scene reads complete before (or
 * without) the scroll engine. While the engine runs, it pins the stage and moves the steps.
 */
export function Scene({
  name,
  len,
  steps,
  finalStep,
  labelledBy,
  minWidth,
  className,
  children,
}: SceneProps) {
  const count = whole(steps, 1, 12);
  const last = whole(finalStep ?? count - 1, 0, count - 1);
  return (
    <section
      className={className ? `pub-scene ${className}` : 'pub-scene'}
      data-scene={name}
      data-len={halves(len)}
      data-steps={count}
      data-step={last}
      {...(minWidth ? { 'data-min-width': whole(minWidth, 1, 4000) } : {})}
      aria-labelledby={labelledBy}
    >
      <div className="pub-scene-stage">{children}</div>
    </section>
  );
}

export type ChapterTone = 'dark' | 'light';

export interface ChapterProps {
  readonly tone: ChapterTone;
  readonly id?: string;
  readonly labelledBy?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * A chapter of the public story: a designed dark or light section (never a theme), so the page
 * looks the same under either device appearance. A dark chapter carries the one approved depth
 * (its navy canvas glow), marked with data-pub-depth.
 */
export function Chapter({ tone, id, labelledBy, className, children }: ChapterProps) {
  const classes = ['pub-chapter', `pub-chapter-${tone}`, className].filter(Boolean).join(' ');
  return (
    <section
      className={classes}
      id={id}
      data-tone={tone}
      aria-labelledby={labelledBy}
      {...(tone === 'dark' ? { 'data-pub-depth': '' } : {})}
    >
      {children}
    </section>
  );
}

/** True when no two chapters in a row share a tone (the approved story alternates them). */
export function tonesAlternate(tones: readonly ChapterTone[]): boolean {
  return tones.every((tone, index) => index === 0 || tone !== tones[index - 1]);
}

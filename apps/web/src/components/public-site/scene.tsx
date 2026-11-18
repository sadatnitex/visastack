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
  /** The step shown without motion (no JavaScript) and where a scene ends. Default: the last. */
  readonly finalStep?: number;
  /**
   * Reveal mode only (phones, short or zoomed windows; not gentle): the step the scene plays up to
   * when it comes into view, and rests on after. The server still writes `finalStep`, so without
   * script and with reduced motion the scene rests there. Default: the same as the finished step.
   */
  readonly playTo?: number;
  /** The heading that names the scene. */
  readonly labelledBy?: string;
  /**
   * The narrowest screen, in CSS pixels, on which this scene is pinned and moves (R1: Home uses 900).
   * Between the engine's own floor and this width the scene is an ordinary finished section. The
   * stylesheet un-pins a scene below 899 px, so 900 is the value it supports today.
   */
  readonly minWidth?: number;
  /**
   * Opts the scene into the kit's centred stage (R1): a pinned stage centres what it shows instead of
   * sitting at the top. Pages built before the kit leave it off and are unchanged.
   */
  readonly kitStage?: boolean;
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
 * `data-rest` repeats the finished step and never changes: reveal mode (phones) plays `data-step`
 * through the steps but keeps layout (which words show) on the finished one.
 */
export function Scene({
  name,
  len,
  steps,
  finalStep,
  playTo,
  labelledBy,
  minWidth,
  kitStage,
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
      data-rest={last}
      {...(playTo === undefined ? {} : { 'data-play-to': whole(playTo, 0, count - 1) })}
      {...(kitStage ? { 'data-kit-stage': '' } : {})}
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

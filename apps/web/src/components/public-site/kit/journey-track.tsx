import { Icon, type IconName } from '../../icons';
import { publicString, publicText } from '../public-text';
import { ExampleTag } from '../story';
import { englishOn } from './doc-kinds';
import './kit-steps.css';
import './kit.css';

export type Actor = 'You' | 'Agency' | 'Embassy';

export interface JourneyStage {
  /** The product's own stage word (lib/case-stages.ts), Title Case. */
  readonly name: string;
  readonly icon: IconName;
  /** Who acts at this stage. */
  readonly actor: Actor;
  /** One plain sentence about what happens at this stage. */
  readonly note: string;
}

export interface JourneyTrackProps {
  readonly stages: readonly JourneyStage[];
  /**
   * Pins one stage as current (an index). Leave out inside a scene with one step per stage: the
   * scene's step is the current stage, and the finished state is the last stage.
   */
  readonly current?: number;
  readonly pageLang?: string;
}

const ACTORS: readonly { readonly name: Actor; readonly icon: IconName }[] = [
  { name: 'You', icon: 'user' },
  { name: 'Agency', icon: 'building' },
  { name: 'Embassy', icon: 'globe' },
];

/**
 * A track of stage nodes that fills as the case moves, and one card under it naming who acts at
 * the stage that is current: you, the agency or the embassy. The stages are examples; the card
 * says so, and never says a decision is made for anyone.
 */
export function JourneyTrack({ stages, current, pageLang = 'en' }: JourneyTrackProps) {
  const say = (text: string) => publicText(text, pageLang);
  const caption = publicString('Example of a case moving through its stages', pageLang);
  const fixed =
    current === undefined
      ? {}
      : { 'data-kit-step': Math.min(stages.length - 1, Math.max(0, current)) };
  return (
    <figure
      className={current === undefined ? 'kit-journey' : 'kit-journey kit-fixed'}
      aria-label={caption.text}
      {...(caption.lang ? { lang: caption.lang } : {})}
      {...fixed}
      {...englishOn(pageLang)}
    >
      <ol className="kit-track">
        {stages.map((stage, index) => (
          <li className="kit-node" key={`${index}-${stage.name}`}>
            {index > 0 ? <span className="kit-link" data-from={index} aria-hidden="true" /> : null}
            <span className="kit-dot" data-from={index + 1} aria-hidden="true">
              <Icon name={stage.icon} size={20} />
            </span>
            <span className="kit-dot kit-dot-now" data-at={index} aria-hidden="true">
              <Icon name={stage.icon} size={22} />
            </span>
            <span className="kit-node-name" data-at={index}>
              <span className="kit-sw sr-only" data-at={index}>
                {say('Now:')}{' '}
              </span>
              {say(stage.name)}
            </span>
          </li>
        ))}
      </ol>
      <div className="kit-stage-card" data-pub-depth="">
        {stages.map((stage, index) => (
          <div className="kit-sw kit-stage" data-at={index} key={`${index}-${stage.name}`}>
            <h3 className="kit-stage-title">{say(stage.name)}</h3>
            <p className="kit-stage-note">{say(stage.note)}</p>
            <ul className="kit-who">
              {ACTORS.map((who) => (
                <li className={who.name === stage.actor ? 'kit-who-on' : undefined} key={who.name}>
                  <Icon name={who.icon} size={18} />
                  <span>{who.name}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="kit-note">
          <ExampleTag pageLang={pageLang} />
          <span>{say('Illustration. Stages follow each real case.')}</span>
        </p>
      </div>
    </figure>
  );
}

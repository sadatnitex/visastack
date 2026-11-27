import type { ReactNode } from 'react';
import { DepthGlow, PassportTilt } from '../public-picture';
import { publicString, publicText } from '../public-text';
import { Chapter } from '../scene';
import { ExampleTag } from '../story';
import { englishOn } from './doc-kinds';
import { RiseIn } from './rise-in';
import './kit.css';

export interface ClosingBandProps {
  /** The heading, written as the page's one closing h2. */
  readonly title: ReactNode;
  readonly sub: ReactNode;
  /** The page's own buttons (`PublicButton`). The band never invents labels or links. */
  readonly actions: ReactNode;
  /** Shows the real passport cover. Default true. */
  readonly passport?: boolean;
  /** The cover's nationality. Default `BD`, the real Bangladesh cover. */
  readonly nationality?: string;
  /** A small line of terms under everything (the page's own words). */
  readonly note?: ReactNode;
  /** The band's anchor, so a link such as `/#start` lands on it. */
  readonly id?: string;
  readonly titleId?: string;
  readonly pageLang?: string;
}

/**
 * The dark closing band: a headline, one sentence, the page's buttons and the real passport cover
 * floating below. The cover is a picture of the type of passport, never anyone's own.
 */
export function ClosingBand({
  title,
  sub,
  actions,
  passport = true,
  nationality = 'BD',
  note,
  id,
  titleId = 'pub-closing-title',
  pageLang = 'en',
}: ClosingBandProps) {
  const cover = publicString(
    nationality === 'BD' ? 'Bangladesh Passport Cover' : 'Passport Cover',
    pageLang,
  );
  return (
    <Chapter tone="dark" className="kit-closing" labelledBy={titleId} {...(id ? { id } : {})}>
      <div className="kit-closing-in">
        <RiseIn>
          <h2 className="kit-h2" id={titleId}>
            {title}
          </h2>
        </RiseIn>
        <RiseIn delay={0.1}>
          <p className="kit-sub">{sub}</p>
        </RiseIn>
        <RiseIn delay={0.2} className="kit-actions">
          {actions}
        </RiseIn>
        {passport ? (
          <figure
            className="kit-closing-passport"
            {...(cover.lang ? { lang: cover.lang } : {})}
            {...englishOn(pageLang)}
          >
            <div className="kit-closing-frame">
              <DepthGlow />
              <PassportTilt nationality={nationality} width={200} label={cover.text} />
            </div>
            <figcaption>
              <ExampleTag pageLang={pageLang} />
              <span>{publicText('The type of cover, not anyone’s own passport.', pageLang)}</span>
            </figcaption>
          </figure>
        ) : null}
        {note ? <p className="kit-closing-note">{note}</p> : null}
      </div>
    </Chapter>
  );
}

import type { ReactElement, ReactNode } from 'react';
import { PassportTilt } from '../../../components/public-site/public-picture';
import { Chapter } from '../../../components/public-site/scene';
import './kit.css';

/** R5 local stand-in for the shared ClosingBand (same props). Swapped for the real kit at the TURN. */
export function ClosingBand({
  title,
  sub,
  actions,
  passport = true,
  nationality = 'BD',
}: {
  readonly title: ReactNode;
  readonly sub: ReactNode;
  readonly actions: ReactNode;
  readonly passport?: boolean;
  readonly nationality?: string;
}): ReactElement {
  return (
    <Chapter tone="dark" labelledBy="closing-band-title" className="r5-closing">
      <div className="container r5-closing-inner">
        <h2 id="closing-band-title" className="r5-closing-title">
          {title}
        </h2>
        <p className="r5-closing-sub">{sub}</p>
        <div className="r5-closing-actions">{actions}</div>
        {passport ? (
          <div className="r5-closing-passport">
            <PassportTilt nationality={nationality} width={220} />
          </div>
        ) : null}
      </div>
    </Chapter>
  );
}

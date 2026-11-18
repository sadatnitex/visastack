import type { ReactNode } from 'react';
import { PassportTilt } from '../../public-site/public-picture';
import { Chapter } from '../../public-site/scene';

/** R4 STAND-IN for the shared kit's ClosingBand (R1-kit-contract.md), same props. Deleted at the R4 turn. */
export interface ClosingBandProps {
  readonly title: ReactNode;
  readonly sub: ReactNode;
  readonly actions: ReactNode;
  readonly passport?: boolean;
  readonly nationality?: string;
  readonly labelledBy?: string;
}

export function ClosingBand({
  title,
  sub,
  actions,
  passport = true,
  nationality = 'BD',
  labelledBy,
}: ClosingBandProps) {
  return (
    <Chapter tone="dark" className="r4s-closing" {...(labelledBy ? { labelledBy } : {})}>
      <div className="container r4s-closing-inner">
        <div className="r4s-closing-copy">
          {title}
          <p>{sub}</p>
          <div className="r4s-closing-actions">{actions}</div>
        </div>
        {passport ? <PassportTilt nationality={nationality} width={200} /> : null}
      </div>
    </Chapter>
  );
}

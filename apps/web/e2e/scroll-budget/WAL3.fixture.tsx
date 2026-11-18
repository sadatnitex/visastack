import type { CasePackage, PackageItem } from '@visastack/services';
import {
  type ReactElement,
  type ReactNode,
  cloneElement,
  isValidElement,
  useEffect,
  useState,
} from 'react';
import { RailSection } from '../../src/app/app/mission/[id]/rail-section';
import { TripChecksPanel } from '../../src/app/app/mission/[id]/trip-checks-panel';
import {
  OutsideVisaStackRow,
  TripJourneyLine,
} from '../../src/app/app/mission/[id]/trip-journey-line';
import { DepthScope, atLevel } from '../../src/components/depth';

/**
 * WAL3 fixture: the real journey line, gap rows, Outside VisaStack icons and Trip Date Checks
 * section with made-up Example data. \`stones\` is how many items the trip needs (the first is
 * ready, the rest are gaps), \`depth\` the level the screen is at.
 */
export interface Wal3FixtureProps {
  readonly stones: number;
  readonly depth: 'glance' | 'browse' | 'everything';
}

const KEYS = [
  'passport',
  'bank_statement',
  'travel_insurance',
  'photo',
  'flight_booking',
  'hotel_booking',
  'invitation_letter',
  'employment_letter',
];
const STATES = [
  'SATISFIED',
  'CRITICAL_GAP',
  'EXPIRING_STALE',
  'CONFLICTING',
  'SATISFIED',
  'CRITICAL_GAP',
  'SATISFIED',
  'EXPIRING_STALE',
] as const;

function pkgOf(stones: number): CasePackage {
  const items: PackageItem[] = Array.from({ length: stones }, (_, i) => ({
    packRequirementId: `00000000-0000-4000-8000-00000000000${i}`,
    kind: 'DOCUMENT',
    key: KEYS[i % KEYS.length] ?? 'passport',
    citation: 'Example only',
    necessity: 'MANDATORY',
    provenance: 'OFFICIAL',
    groupKey: null,
    state: STATES[i % STATES.length] ?? 'SATISFIED',
    blocking: true,
    proposed: null,
    chosen: null,
    alternatives: [],
    newerCopy: null,
    canExclude: false,
  }));
  return {
    missionId: 'example-case',
    phrase: 'NEEDS_ATTENTION',
    reasons: [],
    overallState: 'NEEDS_ACTION',
    requiredCount: stones,
    satisfiedRequired: 0,
    items,
    questions: [],
    freshness: null,
    outsideSteps: [
      {
        kind: 'APPLICATION_FORM',
        label: 'Fill in and send the official application form yourself.',
        namedByChecklist: false,
      },
      {
        kind: 'APPOINTMENT',
        label: 'Book any appointment the embassy or visa centre asks for.',
        namedByChecklist: false,
      },
      {
        kind: 'ORIGINALS',
        label: 'Bring the original documents if you are asked to show them.',
        namedByChecklist: false,
      },
      {
        kind: 'FEE',
        label: 'Pay the official fee where the authority says.',
        namedByChecklist: false,
      },
    ],
    latestHandoff: null,
    change: null,
    available: true,
    active: true,
  };
}

/**
 * A browser root cannot wait for a server component, and the real panel holds two (the stage
 * tracker and the progress summary). This walks the tree once before it is mounted: a function
 * component that is async, or that holds no hooks, is called and replaced by what it returns; a
 * client component (its hooks throw outside a render) stays as it is. The panel itself is the
 * real one, not a copy.
 */
async function expand(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(expand));
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === 'function') {
    try {
      const out = await (el.type as (props: unknown) => ReactNode | Promise<ReactNode>)(el.props);
      return expand(out);
    } catch (error) {
      // A client component (its hooks throw outside a render) stays as it is; any other error is real.
      if (!/hook|error #321|reading 'use[A-Z]/i.test(String(error))) throw error;
    }
  }
  const children = el.props.children;
  if (children === undefined) return el;
  return cloneElement(el, undefined, await expand(children));
}

export default function Wal3Fixture(props: Wal3FixtureProps) {
  const [tree, setTree] = useState<ReactNode>(null);
  const [failure, setFailure] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    expand(<Wal3Page {...props} />).then(
      (done) => live && setTree(done),
      (error) => live && setFailure(error),
    );
    return () => {
      live = false;
    };
  }, [props]);
  if (failure) throw failure;
  return tree ?? <div data-wal3-loading="" />;
}

function Wal3Page({ stones, depth }: Wal3FixtureProps) {
  const pkg = pkgOf(stones);
  return (
    <DepthScope family="case" depth={depth}>
      <section className="section container lift-case">
        <TripJourneyLine pkg={pkg} />
        <article className="card" id="trip-package" {...atLevel('browse')}>
          <h2 className="card-title">Trip Package</h2>
          <OutsideVisaStackRow steps={pkg.outsideSteps} />
        </article>
        <aside className="split-rail lift-rail" aria-label="About This Case" {...atLevel('browse')}>
          <RailSection
            id="trip-checks"
            level="browse"
            title="Trip Date Checks"
            summary="2 checks on your trip dates"
            open
          >
            <TripChecksPanel
              checks={[
                {
                  key: 'passport_validity',
                  level: 'problem',
                  title: 'Example passport ends before the trip',
                  detail: 'Example only.',
                },
                {
                  key: 'insurance_cover',
                  level: 'ok',
                  title: 'Example insurance covers the trip',
                  detail: 'Example only.',
                },
              ]}
            />
          </RailSection>
        </aside>
      </section>
    </DepthScope>
  );
}

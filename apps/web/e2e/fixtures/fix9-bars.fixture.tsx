import { CreateMissionForm } from '../../src/app/app/applicant/[id]/missions/create-mission-form';
import { ConsentForm } from '../../src/app/oauth/authorize/consent-form';
import { StickyActionBar } from '../../src/components/sticky-action-bar';
import { caseCountryOptions, casePurposeGroups } from '../../src/lib/case-choices';

/**
 * FIX9: the three screens that pin an action bar at the bottom, on the real stylesheet, each with
 * the phone navigation bar the app shell draws around them (the sign-in consent screen is drawn
 * without it). The consent screen and the Start a Case form are the real components (their server
 * ends are stand-ins); the calendar page's bar is the same shared bar around its own button. Used
 * by e2e/wallet/fix9-sticky-bar.spec.ts.
 */
export interface Fix9FixtureProps {
  readonly screen: 'consent' | 'create-case' | 'calendar';
  /** Draw the app shell's navigation bar (every screen but the consent screen has it). */
  readonly shell?: boolean;
}

const CASES = Array.from({ length: 8 }, (_, i) => ({
  id: `11111111-1111-4111-8111-00000000000${i}`,
  title: `Synthetic Trip ${i}`,
}));

function Shell() {
  return (
    <nav className="app-shell-nav" aria-label="Main">
      <div className="app-bar">
        <div className="app-shell-links">
          <a href="#home">Home</a>
          <a href="#cases">Cases</a>
          <a href="#documents">Documents</a>
          <a href="#profile">Profile</a>
        </div>
        <button type="button" className="app-more-toggle" aria-expanded="false">
          More
        </button>
      </div>
    </nav>
  );
}

export default function Fix9BarsFixture({ screen, shell = true }: Fix9FixtureProps) {
  return (
    <div className="app-frame">
      {shell ? <Shell /> : null}
      <div className="app-main">
        {screen === 'consent' ? (
          <ConsentForm
            request={{
              clientId: 'client-1',
              redirectUri: 'https://app.example.test/callback',
              codeChallenge: 'challenge',
              resource: 'https://vs.example.test/mcp',
              state: 'state-1',
            }}
            appName="Synthetic App"
            record={{ id: '33333333-3333-4333-8333-333333333333', name: 'Synthetic Traveller' }}
            cases={CASES}
          />
        ) : null}
        {screen === 'create-case' ? (
          <CreateMissionForm
            applicantId="44444444-4444-4444-8444-444444444444"
            countries={caseCountryOptions()}
            purposes={casePurposeGroups()}
            openDetails
          />
        ) : null}
        {screen === 'calendar' ? (
          <form>
            <div style={{ height: 1800 }}>Synthetic dates to choose from</div>
            <StickyActionBar label="Preview Your Dates">
              <button type="submit" className="btn btn-primary">
                Preview
              </button>
            </StickyActionBar>
          </form>
        ) : null}
      </div>
    </div>
  );
}

import { WorkspaceShell } from '../../src/app/app/workspace-shell';
import Sb2Fixture from '../scroll-budget/WP-SB2.fixture';

/**
 * The real signed-in shell (sidebar, toolbar) around the case workspace, with made-up people and no
 * server. The type scale check reads every size the page really draws.
 */
export default function TypeAudit() {
  return (
    <WorkspaceShell
      access={{
        travellers: [{ id: 'synthetic', name: 'Synthetic Self', relationship: 'SELF' }],
        agencies: [],
        platform: null,
      }}
      accountName="Synthetic Self"
      accountEmail="synthetic.self@example.test"
      sidebarState="expanded"
      toolbarState={{
        unread: 2,
        personalPlan: { key: 'traveller_free', name: 'Traveller Free' },
        agencyPlans: [],
      }}
      signOut={
        <form>
          <button type="submit" className="btn btn-secondary nav-cta">
            Sign Out
          </button>
        </form>
      }
    >
      <Sb2Fixture view="case" />
    </WorkspaceShell>
  );
}

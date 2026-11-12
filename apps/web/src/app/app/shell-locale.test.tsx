import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../components/i18n-provider';
import { appHomeCatalog } from '../../i18n/app-home';
import { navigationState, textOf } from '../../lib/next-mocks.test-support';
import type { WorkspaceAccess } from '../../lib/workspace-navigation';
import { AccountMenu } from './account-menu';
import { WorkspaceShell } from './workspace-shell';

// Wording the owner signed off on 2026-11-12, drawn under Bengali.
const bn = appHomeCatalog.bn as Record<string, string>;
const en = appHomeCatalog.en as Record<string, string>;
const ACCESS: WorkspaceAccess = {
  travellers: [
    { id: '10000000-0000-4000-8000-000000000001', name: 'Synthetic Self', relationship: 'SELF' },
  ],
  agencies: [],
  platform: null,
};

describe('the workspace shell and the account menu under Bengali', () => {
  it('the shell says sharing follows the saved permissions', () => {
    navigationState.pathname = '/app';
    const html = renderToStaticMarkup(
      <I18nProvider locale="bn" pageLang="bn">
        <WorkspaceShell access={ACCESS} accountName="Synthetic Self" signOut={<span />}>
          <p>Page</p>
        </WorkspaceShell>
      </I18nProvider>,
    );
    const key = 'appHome.appWorkspaceShell.sharingFollowsYourSavedPermissions';
    expect(textOf(html)).toContain(bn[key]);
    expect(textOf(html)).not.toContain(en[key]);
    expect(html).not.toMatch(/appHome\.app[A-Z]/);
  });

  it('the account menu names the plan for a screen reader', () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="bn" pageLang="bn">
        <AccountMenu
          name="Synthetic Self"
          email="synthetic.self@example.test"
          plan={{ name: 'Traveller Free', href: '/app/account' }}
          signOut={<span />}
        />
      </I18nProvider>,
    );
    expect(textOf(html)).toContain(bn['appHome.appAccountMenu.yourPlan']);
    expect(html).not.toMatch(/appHome\.app[A-Z]/);
  });
});

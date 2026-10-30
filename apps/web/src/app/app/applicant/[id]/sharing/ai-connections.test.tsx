import type { AiConnectionList, AiConnectionSummary } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../lib/axe.test-support';
import { textOf } from '../../../../../lib/next-mocks.test-support';

vi.mock('./ai-connection-actions', () => ({
  turnOffAiConnectionAction: vi.fn(),
  changeAiAccessAction: vi.fn(),
}));
const { AiConnectionsSection, aiCaseLine, caseOptionsFor, changeDurations, storedChoices } =
  await import('./ai-connections');

const APPLICANT = '11111111-1111-4111-8111-111111111111';

function connection(overrides: Partial<AiConnectionSummary> = {}): AiConnectionSummary {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    clientName: 'Claude',
    clientHost: 'claude.ai',
    connectedAt: new Date('2026-10-06T10:00:00Z'),
    scopes: ['identity', 'travel_documents', 'document_list'],
    caseMode: 'ALL_CURRENT',
    missionId: null,
    caseTitle: null,
    revealIdentifiers: false,
    expiresAt: null,
    lastUsedAt: null,
    endedAt: null,
    endedBy: null,
    ...overrides,
  };
}

const list = (overrides: Partial<AiConnectionList> = {}): AiConnectionList => ({
  available: true,
  active: [],
  recentlyEnded: [],
  activeTotal: overrides.active?.length ?? 0,
  ...overrides,
});

const render = (props: Parameters<typeof AiConnectionsSection>[0]) =>
  renderToStaticMarkup(<AiConnectionsSection {...props} />);

describe('the AI Connections section', () => {
  it('lists each live connection in the consent screen words, with both actions', async () => {
    const html = render({
      applicantId: APPLICANT,
      connectorOn: true,
      list: list({
        active: [
          connection(),
          connection({
            id: '33333333-3333-4333-8333-333333333333',
            clientName: 'ChatGPT',
            clientHost: 'chatgpt.com',
            scopes: ['money', 'health', 'document_text'],
            caseMode: 'ONE',
            missionId: '44444444-4444-4444-8444-444444444444',
            caseTitle: 'UK Visit',
            revealIdentifiers: true,
            expiresAt: new Date('2026-11-05T10:00:00Z'),
            lastUsedAt: new Date('2026-10-07T09:00:00Z'),
          }),
        ],
      }),
    });
    const text = textOf(html);
    expect(text).toContain('AI Connections');
    expect(text).toContain('claude.ai');
    expect(text).toContain('Connected');
    expect(text).toContain('6 Oct 2026');
    expect(text).toContain(
      'Personal Details, Passports and Travel Documents, List of My Documents',
    );
    expect(text).toContain('Money, Health, Text Read From My Documents');
    expect(text).toContain('All Current Cases');
    expect(text).toContain('Only UK Visit');
    expect(text).toContain('Until You Turn It Off');
    expect(text).toContain('5 Nov 2026');
    expect(text).toContain('Not Used Yet');
    expect(text).toMatch(/Full Document Numbers\s*No/);
    expect(text).toMatch(/Full Document Numbers\s*Yes/);
    // Change Access is a closed disclosure in each row, with the consent screen's own fields.
    expect(html.match(/<details class="ai-connection-change">/g)).toHaveLength(2);
    expect(
      html.match(
        /<summary class="btn btn-secondary" aria-label="Change Access for (Claude|ChatGPT)">Change Access<\/summary>/g,
      ),
    ).toHaveLength(2);
    expect(text).toContain('What Claude Can Read');
    expect(html).toContain('aria-label="Turn Off Claude"');
    expect(await axeViolations(html)).toEqual([]);
  });

  it('uses no engineering words anywhere a person can read', () => {
    const html = render({
      applicantId: APPLICANT,
      connectorOn: true,
      notice: 'changed',
      list: list({
        active: [connection()],
        recentlyEnded: [
          connection({ endedAt: new Date('2026-10-08T10:00:00Z'), endedBy: 'owner' }),
        ],
      }),
    });
    const visible = textOf(html).toLowerCase();
    for (const banned of ['oauth', 'mcp', 'token', 'scope', 'client', 'api', 'mission']) {
      expect(visible, banned).not.toMatch(new RegExp(`\\b${banned}`));
    }
  });

  it('is hidden while connecting is off and nothing is connected, but still offers Turn Off', () => {
    expect(render({ applicantId: APPLICANT, connectorOn: false, list: list() })).toBe('');
    const html = render({
      applicantId: APPLICANT,
      connectorOn: false,
      list: list({
        active: [connection()],
        recentlyEnded: [connection({ endedAt: new Date(), endedBy: 'time' })],
      }),
    });
    expect(textOf(html)).toContain('Turn Off');
    expect(textOf(html)).not.toContain('Change Access');
    expect(textOf(html)).not.toContain('Recently Turned Off');
  });

  it('says plainly when nothing is connected, or when the list cannot be read', () => {
    expect(textOf(render({ applicantId: APPLICANT, connectorOn: true, list: list() }))).toContain(
      'No AI apps are connected to this record.',
    );
    const unavailable = textOf(
      render({ applicantId: APPLICANT, connectorOn: true, list: list({ available: false }) }),
    );
    expect(unavailable).toContain('AI connections cannot be shown right now.');
    expect(unavailable).not.toContain('No AI apps are connected');
  });

  it('keeps recently ended connections in a short disclosure', () => {
    const text = textOf(
      render({
        applicantId: APPLICANT,
        connectorOn: true,
        notice: 'off',
        list: list({
          recentlyEnded: [
            connection({ endedAt: new Date('2026-10-08T10:00:00Z'), endedBy: 'owner' }),
            connection({
              id: '55555555-5555-4555-8555-555555555555',
              endedAt: new Date('2026-10-09T10:00:00Z'),
              endedBy: 'time',
            }),
          ],
        }),
      }),
    );
    expect(text).toContain('Turned off. That app can no longer read this record.');
    expect(text).toContain('Recently Turned Off (2)');
    expect(text).toContain('You turned it off 8 Oct 2026');
    expect(text).toContain('Time ran out 9 Oct 2026');
  });

  it('names the case a one-case connection covers, or says it was removed', () => {
    expect(aiCaseLine({ caseMode: 'NONE', caseTitle: null })).toBe('No Cases');
    expect(aiCaseLine({ caseMode: 'ONE', caseTitle: null })).toBe(
      'No Cases. The chosen case was removed.',
    );
  });
});

describe('Change Access in each row', () => {
  const ownCase = '44444444-4444-4444-8444-444444444444';
  const oneCase = connection({
    scopes: ['money', 'document_text'],
    caseMode: 'ONE',
    missionId: ownCase,
    caseTitle: 'Old Trip',
    revealIdentifiers: true,
    expiresAt: new Date('2026-11-05T10:00:00Z'),
  });

  it('starts from what the app can read now and keeps the current end', () => {
    expect(storedChoices(oneCase)).toEqual({
      layers: ['money'],
      cases: ownCase,
      documentList: false,
      documentText: true,
      revealIdentifiers: true,
      suggestChanges: false,
    });
    expect(changeDurations(oneCase).map((item) => item.value)).toEqual([
      'keep',
      '1h',
      '24h',
      '7d',
      '30d',
      'until_off',
    ]);
    expect(changeDurations(oneCase)[0]?.label).toContain('Keep the Current End (5 Nov 2026');
    expect(changeDurations(connection())[0]?.label).toBe('Keep Until I Turn It Off');
    expect(changeDurations(oneCase)[1]?.label).toBe('1 Hour from Now');
  });

  it("keeps the connection's own case choosable after it closed", () => {
    const current = [{ id: 'm1', title: 'UK Visit' }];
    expect(caseOptionsFor(oneCase, current).map((item) => item.id)).toEqual(['m1', ownCase]);
    expect(caseOptionsFor(connection(), current)).toEqual(current);
  });

  it('opens with the person own choices after a fresh sign-in check', () => {
    const html = render({
      applicantId: APPLICANT,
      connectorOn: true,
      cases: [{ id: 'm1', title: 'UK Visit' }],
      list: list({ active: [oneCase] }),
      returning: {
        connectionId: oneCase.id,
        choices: {
          layers: ['identity'],
          cases: 'm1',
          documentList: true,
          documentText: false,
          revealIdentifiers: true,
          suggestChanges: false,
        },
        duration: '7d',
      },
    });
    expect(html).toContain('<details class="ai-connection-change" open="">');
    expect(html).toMatch(/checked="" value="identity"/);
    expect(html).not.toMatch(/checked="" value="money"/);
    expect(html).toMatch(/checked="" value="m1"/);
    expect(html).toMatch(/<option value="7d" selected="">/);
  });

  it('says how many more are connected when the list is capped, never dropping them silently', () => {
    const text = textOf(
      render({
        applicantId: APPLICANT,
        connectorOn: true,
        list: list({ active: [connection()], activeTotal: 4 }),
      }),
    );
    expect(text).toContain('And 3 more connected AI apps, not shown here.');
  });

  it('still says what just happened while connecting is off and nothing is left', () => {
    const text = textOf(
      render({ applicantId: APPLICANT, connectorOn: false, notice: 'off', list: list() }),
    );
    expect(text).toContain('Turned off. That app can no longer read this record.');
    expect(text).not.toContain('No AI apps are connected');
  });
});

describe('Suggest Changes on AI Connections (S21)', () => {
  const render = (props: Partial<Parameters<typeof AiConnectionsSection>[0]> = {}) =>
    renderToStaticMarkup(
      <AiConnectionsSection
        applicantId={APPLICANT}
        list={list({ active: [connection()] })}
        connectorOn
        {...props}
      />,
    );

  it('with the feature off and no app allowed to suggest, reads exactly as before S21', () => {
    const before = render();
    expect(render({ suggestionsAvailable: false })).toBe(before);
    const text = textOf(before);
    expect(text).toContain('cannot change anything in VisaStack');
    // Only the Change Access form mentions the choice, turned off with its plain sentence.
    expect(before).toContain('name="suggest_changes"');
    expect(before).toMatch(
      /<input[^>]*name="suggest_changes"[^>]*disabled=""|<input[^>]*disabled=""[^>]*name="suggest_changes"/,
    );
    expect(text).toContain(
      'This AI feature is turned off right now. Everything else works as usual.',
    );
    expect(text).not.toContain('Your choice is kept');
    expect(before).not.toContain('<dt>Suggest Changes</dt>');
  });

  it('keeps an app’s choice while the feature is off, and the person can still untick it', () => {
    const html = render({
      list: list({ active: [connection({ scopes: ['identity', 'suggest_changes'] })] }),
    });
    expect(html).toContain('<dt>Suggest Changes</dt>');
    expect(textOf(html)).toContain('Yes, but turned off right now');
    // Ticked and enabled, so it can be unticked; nothing hidden carries it.
    const box = html.match(/<input[^>]*name="suggest_changes"[^>]*>/)?.[0] ?? '';
    expect(box).toContain('checked=""');
    expect(box).not.toContain('disabled');
    expect(html).not.toContain('type="hidden" name="suggest_changes"');
    expect(textOf(html)).toContain('Your choice is kept for when it is turned on again.');
    expect(textOf(html)).toContain('Suggested updates change nothing until you accept them');
  });

  it('offers the choice when the feature is on', () => {
    const html = render({
      suggestionsAvailable: true,
      list: list({ active: [connection({ scopes: ['identity', 'suggest_changes'] })] }),
    });
    expect(html).not.toMatch(
      /<input[^>]*name="suggest_changes"[^>]*disabled=""|<input[^>]*disabled=""[^>]*name="suggest_changes"/,
    );
    expect(html).not.toContain('type="hidden" name="suggest_changes"');
    expect(textOf(html)).not.toContain('turned off right now');
    expect(storedChoices(connection({ scopes: ['suggest_changes'] })).suggestChanges).toBe(true);
  });
});

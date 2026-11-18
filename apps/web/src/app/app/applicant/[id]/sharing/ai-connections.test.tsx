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

/** The names of each tile's pictures, tile by tile, as a screen reader hears the buttons. */
function tileReads(html: string): string[][] {
  return html
    .split('data-ai-tile=""')
    .slice(1)
    .map((tile) =>
      [...tile.matchAll(/<span class="sr-only">([^<]*)<\/span><\/button>/g)].map((m) => m[1] ?? ''),
    );
}

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
    // WAL5: what each app can read is one picture per thing, in the consent screen's words and
    // order, each a button named by its label.
    expect(tileReads(html)).toEqual([
      [
        'Personal Details',
        'Passports and Travel Documents',
        'List of My Documents',
        'Cases: All Current Cases',
        'Full Document Numbers: No',
      ],
      [
        'Money',
        'Health',
        'Text Read From My Documents',
        'Cases: Only UK Visit',
        'Full Document Numbers: Yes',
      ],
    ]);
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
    expect(before).not.toContain('<span class="sr-only">Suggest Changes: ');
  });

  it('keeps an app’s choice while the feature is off, and the person can still untick it', () => {
    const html = render({
      list: list({ active: [connection({ scopes: ['identity', 'suggest_changes'] })] }),
    });
    expect(html).toContain('<span class="sr-only">Suggest Changes: ');
    expect(textOf(html)).toContain('Yes, but turned off right now');
    // Ticked and enabled, so it can be unticked; nothing hidden carries it.
    const box = html.match(/<input[^>]*name="suggest_changes"[^>]*>/)?.[0] ?? '';
    expect(box).toContain('checked=""');
    expect(box).not.toContain('disabled');
    expect(html).not.toContain('type="hidden" name="suggest_changes"');
    expect(textOf(html)).toContain('Your choice is kept for when it is turned on again.');
    expect(textOf(html)).toContain('Suggested updates change nothing until you accept them');
  });

  it('a crafted Change Access link with choice_suggest=1 never ticks it: it starts from the stored scope', () => {
    const crafted = {
      connectionId: connection().id,
      choices: {
        layers: ['identity'] as const,
        cases: 'all' as const,
        documentList: true,
        documentText: false,
        revealIdentifiers: false,
        suggestChanges: true,
      },
      duration: 'keep' as const,
    };
    for (const suggestionsAvailable of [true, false]) {
      const html = render({ suggestionsAvailable, returning: crafted });
      const box = html.match(/<input[^>]*name="suggest_changes"[^>]*>/)?.[0] ?? '';
      expect(box).not.toContain('checked');
      expect(html).toContain('<details class="ai-connection-change" open="">');
    }
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

describe('Original Files on the AI Connections section (S20)', () => {
  const DOC = '55555555-5555-4555-8555-555555555555';
  const files = (available: boolean) => ({
    view: {
      available,
      candidates: [
        {
          documentId: DOC,
          referenceCode: 'D-7K2Q9M',
          kind: 'Visa',
          group: 'Travel and Immigration',
          safeCopyReady: true,
        },
      ],
    },
    byConnection: {
      [connection().id]: [{ documentId: DOC, variant: 'ORIGINAL' as const }],
    },
  });

  it('says how many files the app can receive, and offers them in Change Access as stored', async () => {
    const html = render({
      applicantId: APPLICANT,
      connectorOn: true,
      list: list({ active: [connection()] }),
      files: files(true),
    });
    const text = textOf(html);
    expect(text).toContain('Original Files');
    expect(text).toContain('1 File (Original)');
    expect(html).toContain('Visa (D-7K2Q9M)');
    const box = html.match(/<input[^>]*name="file"[^>]*>/)?.[0] ?? '';
    expect(box).toContain(`value="${DOC}"`);
    expect(box).toContain('checked');
    expect(await axeViolations(html)).toEqual([]);
  });

  it('says when the feature is off, and keeps what was ticked', () => {
    const text = textOf(
      render({
        applicantId: APPLICANT,
        connectorOn: true,
        list: list({ active: [connection()] }),
        files: files(false),
      }),
    );
    expect(text).toContain('1 File (Original), but turned off right now');
    expect(text).toContain('Files you ticked stay ticked, and you can untick them.');
  });

  it('shows nothing about files when the connection has none', () => {
    const text = textOf(
      render({
        applicantId: APPLICANT,
        connectorOn: true,
        list: list({ active: [connection()] }),
        files: { ...files(true), byConnection: {} },
      }),
    );
    expect(text).not.toContain('File (');
  });
});

describe('the AI Connections section while AI App Access is off (S28)', () => {
  it('says so plainly and keeps every connection listed, with its controls', async () => {
    const { AI_FEATURE_OFF_HINT, AI_FEATURE_LIMIT_HINT } = await import(
      '@visastack/core/ai-features'
    );
    const html = render({
      applicantId: APPLICANT,
      connectorOn: true,
      list: list({ active: [connection()] }),
      accessOff: 'turned_off',
    });
    const text = textOf(html);
    expect(text).toContain(AI_FEATURE_OFF_HINT);
    expect(text).toContain('Claude');
    expect(text).toContain('Turn Off');
    expect(await axeViolations(html)).toEqual([]);
    expect(
      textOf(
        render({
          applicantId: APPLICANT,
          connectorOn: true,
          list: list({ active: [connection()] }),
          accessOff: 'daily_limit',
        }),
      ),
    ).toContain(AI_FEATURE_LIMIT_HINT);
    // Nothing to say when no app is connected; with the feature on, the sentence is not added.
    expect(
      textOf(render({ applicantId: APPLICANT, connectorOn: true, list: list(), accessOff: null })),
    ).not.toContain(AI_FEATURE_OFF_HINT);
    const count = (markup: string) => textOf(markup).split(AI_FEATURE_OFF_HINT).length - 1;
    const on = render({
      applicantId: APPLICANT,
      connectorOn: true,
      list: list({ active: [connection()] }),
    });
    expect(count(html)).toBe(count(on) + 1);
  });
});

describe('one tile per AI connection (WAL5)', () => {
  // A fixed clock far from the real today.
  const NOW = new Date(Date.UTC(2030, 0, 15, 12, 0));

  it('draws one tile per live connection, each with its own clock and both actions', () => {
    const html = render({
      applicantId: APPLICANT,
      connectorOn: true,
      now: NOW,
      timeZone: 'Asia/Dhaka',
      list: list({
        active: [
          connection({
            connectedAt: new Date(Date.UTC(2030, 0, 14, 12)),
            expiresAt: new Date(Date.UTC(2030, 1, 13, 12)),
          }),
          connection({
            id: '33333333-3333-4333-8333-333333333333',
            clientName: 'ChatGPT',
            clientHost: 'chatgpt.com',
            connectedAt: new Date(Date.UTC(2030, 0, 14, 16)),
            expiresAt: new Date(Date.UTC(2030, 0, 15, 16)),
          }),
        ],
      }),
    });
    expect(html.match(/data-ai-tile=""/g)).toHaveLength(2);
    expect(html.match(/aria-label="Change Access for (Claude|ChatGPT)"/g)).toHaveLength(2);
    expect(html.match(/aria-label="Turn Off (Claude|ChatGPT)"/g)).toHaveLength(2);
    const [first = '', second = ''] = html.split('data-ai-tile=""').slice(1);
    expect(textOf(first)).toContain('29 Days Left');
    expect(first).toContain('data-state="running"');
    // 24 hours, 4 left: ending soon, in hours.
    expect(second).toContain('data-state="ending_soon"');
    expect(textOf(second)).toContain('4 Hours Left');
    expect(textOf(second)).toContain('Ending Soon');
  });

  it('writes Connected, Ends and Last Used in the person time zone', () => {
    const late = connection({
      connectedAt: new Date(Date.UTC(2030, 0, 14, 20)),
      expiresAt: new Date(Date.UTC(2030, 0, 20, 20)),
      lastUsedAt: new Date(Date.UTC(2030, 0, 15, 1)),
    });
    const dhaka = textOf(
      render({
        applicantId: APPLICANT,
        connectorOn: true,
        now: NOW,
        timeZone: 'Asia/Dhaka',
        list: list({ active: [late] }),
      }),
    );
    // 20:00 UTC is 02:00 the next day in Dhaka.
    expect(dhaka).toMatch(/Connected\s*15 Jan 2030/);
    expect(dhaka).toMatch(/Ends\s*21 Jan 2030, 02:00/);
    expect(dhaka).toMatch(/Last Used\s*15 Jan 2030, 07:00/);
    expect(dhaka).toContain('6 Days Left');
    const unknown = textOf(
      render({
        applicantId: APPLICANT,
        connectorOn: true,
        now: NOW,
        timeZone: 'Not/AZone',
        list: list({ active: [late] }),
      }),
    );
    expect(unknown).toMatch(/Connected\s*14 Jan 2030/);
    expect(unknown).toMatch(/Ends\s*20 Jan 2030, 20:00/);
    expect(unknown).toContain('5 Days Left');
  });

  it('says what each picture means, in the consent screen sentences', async () => {
    const html = render({
      applicantId: APPLICANT,
      connectorOn: true,
      now: NOW,
      timeZone: 'UTC',
      list: list({
        active: [connection({ revealIdentifiers: true, scopes: ['identity', 'document_text'] })],
      }),
    });
    const text = textOf(html);
    expect(text).toContain('Name, date of birth, nationality and contact details.');
    expect(text).toContain(
      'Sensitive: the words read from documents in the parts you allow above.',
    );
    expect(text).toContain(
      'Sensitive: shows whole passport and ID numbers instead of the last three characters.',
    );
    expect(text).toContain('Which of your cases this app can read.');
    expect(await axeViolations(html)).toEqual([]);
  });

  it('still says when an app reads nothing from the record', () => {
    const text = textOf(
      render({
        applicantId: APPLICANT,
        connectorOn: true,
        now: NOW,
        list: list({ active: [connection({ scopes: [] })] }),
      }),
    );
    expect(text).toContain('Nothing from this record');
  });
});

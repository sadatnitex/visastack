// @vitest-environment jsdom
import {
  type ChangeImpact,
  IMPACT_OUTCOMES,
  IMPACT_REASON_OUTCOME,
  type ImpactReason,
} from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { changeImpactCatalog } from '../../../../../i18n/change-impact';
import { axeViolations } from '../../../../../lib/axe.test-support';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { partsTranslator } from '../../../../../lib/language-parts';
import '../../../../../lib/next-mocks.test-support';
import { isTitleCase } from '../../../../../lib/title-case';
import { ChangeImpactFailed } from './change-impact-failed';
import { ChangeImpactNotice } from './change-impact-notice';
import { ChangeImpactReview } from './change-impact-review';
import {
  AGENCY_A,
  AGENCY_B,
  ALL_REVIEWS,
  APPLICANT_ID,
  DECIDED,
  DETAIL_INCOMPLETE,
  DETAIL_RECORDED,
  DETAIL_SUBJECT,
  DOCUMENT_PREVIEW,
  DOCUMENT_RECORDED,
  DOCUMENT_UNDATED,
  FINISHED_CASE,
  LIVE_CASE,
  OTHER_LIVE_CASE,
  PERSON,
  QUIET_EMPTY,
  QUIET_WITH_HISTORY,
  SENT,
  item,
  request,
  review,
  share,
} from './fixtures.test-support';
import { SECTION_ORDER, changeImpactHref, changeImpactSummary } from './impact-words';

/**
 * What This Change Affects, as a person reads it: every reason has its own whole sentence and the
 * right link, sections come in the agreed order, a quiet change raises nothing, and no sentence
 * says more than the records prove.
 */

const t = partsTranslator(changeImpactCatalog, 'en', 'en');
const SENT_DAY = formatTimestampDate(SENT, 'en');
const DECIDED_DAY = formatTimestampDate(DECIDED, 'en');
const EVIDENCE = `/app/applicant/${APPLICANT_ID}/evidence`;
const requestHref = (id: string) => `${EVIDENCE}?item=${id}#request-${id}`;

function html(impact: ChangeImpact, props: Partial<Parameters<typeof ChangeImpactReview>[0]> = {}) {
  return renderToStaticMarkup(
    <ChangeImpactReview impact={impact} applicantId={APPLICANT_ID} t={t} locale="en" {...props} />,
  );
}

function dom(markup: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
}

const words = (node: Element | null | undefined) =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

function row(host: HTMLElement, reason: ImpactReason): HTMLElement {
  const found = host.querySelectorAll<HTMLElement>(`li[data-reason="${reason}"]`);
  expect(found.length, `one row for ${reason}`).toBe(1);
  return found[0] as HTMLElement;
}

interface Expected {
  readonly why: string;
  /** The link's address and name, or null when the row must not offer one. */
  readonly link: readonly [href: string, name: string] | null;
}

const DOCUMENT_ROWS: Partial<Record<ImpactReason, Expected>> = {
  LIVE_CASE_USES_REPLACED_DOCUMENT: {
    why: `${LIVE_CASE} still uses the earlier document. Open the case, choose the document it should use, then confirm the case again.`,
    link: ['/app/mission/m-live-1', 'Open the Case'],
  },
  AGENCY_WAITING_FOR_REPLACEMENT: {
    why: `${AGENCY_A} sent back what you sent on ${SENT_DAY} and is waiting for your answer. Nothing is sent until you answer it.`,
    link: [requestHref('r-1'), 'Open the Request'],
  },
  AGENCY_CHECKING_EARLIER: {
    why: `${AGENCY_A} is still checking the earlier copy you sent on ${SENT_DAY}. The newer one was not sent.`,
    link: [requestHref('r-2'), 'Open the Request'],
  },
  AGENCY_ACCEPTED_EARLIER_LIVE_WORK: {
    why: `${AGENCY_A} accepted the earlier copy you sent on ${SENT_DAY}, and their work with you is still in progress. The accepted copy stays exactly as sent. The newer one was not sent to them.`,
    link: [requestHref('r-3'), 'Open the Request'],
  },
  SHARE_COVERS_EARLIER_ONLY: {
    why: `${AGENCY_B} can open the earlier document because you shared it by name. The newer document is not shared with them. Nothing changes unless you change it in sharing.`,
    link: [`/app/applicant/${APPLICANT_ID}/sharing`, 'Open Sharing'],
  },
  LIVE_CASE_KEEPS_EARLIER_COPY: {
    why: `${OTHER_LIVE_CASE} is set to use the earlier copy you chose. It stays that way unless you change it in the case.`,
    link: ['/app/mission/m-live-2', 'Open the Case'],
  },
  RECORD_INCOMPLETE: {
    why: `The record of what was sent to ${AGENCY_A} does not add up, so we cannot tell what this change means for it.`,
    link: [requestHref('r-4'), 'Open the Request'],
  },
  FINISHED_CASE_KEPT: {
    why: `${FINISHED_CASE} is finished. It keeps the earlier copy exactly as it was.`,
    link: null,
  },
  AGENCY_ACCEPTED_EARLIER_FINISHED_WORK: {
    why: `${AGENCY_A} accepted the earlier copy on ${DECIDED_DAY}. That record stays exactly as it was.`,
    link: null,
  },
  SHARE_ALREADY_COVERS: {
    why: `${PERSON} can open your current records under the sharing you set up. This change sends them nothing.`,
    link: null,
  },
  AGENCY_HOLDS_CURRENT: {
    why: `You already sent ${AGENCY_B} the current copy.`,
    link: null,
  },
};

const DETAIL_ROWS: Partial<Record<ImpactReason, Expected>> = {
  LIVE_CASE_CONFIRMATION_VOID: {
    why: `You confirmed ${LIVE_CASE} with the earlier value. That confirmation no longer counts. Open the case and confirm it again.`,
    link: ['/app/mission/m-live-1', 'Open the Case'],
  },
  AGENCY_WAITING_FOR_REPLACEMENT: {
    why: `${AGENCY_A} sent back what you sent on ${SENT_DAY} and is waiting for your answer. Nothing is sent until you answer it.`,
    link: [requestHref('r-1'), 'Open the Request'],
  },
  AGENCY_CHECKING_EARLIER: {
    why: `${AGENCY_A} is still checking the earlier answer you sent on ${SENT_DAY}. The new value was not sent.`,
    link: [requestHref('r-2'), 'Open the Request'],
  },
  AGENCY_ACCEPTED_EARLIER_LIVE_WORK: {
    why: `${AGENCY_A} accepted the earlier answer you sent on ${SENT_DAY}, and their work with you is still in progress. The accepted answer stays exactly as sent. The new value was not sent to them.`,
    // An answered checklist is listed with the person's other answers.
    link: ['/collect/account/answers', 'Open Your Answers'],
  },
  SENT_BEFORE_EXACT_VERSIONS: {
    why: `You answered ${AGENCY_A} on ${SENT_DAY}, before exact copies were kept. We cannot tell which value was sent.`,
    link: [requestHref('r-7'), 'Open the Request'],
  },
  FINISHED_CASE_NO_SAVED_COPY: {
    why: `${FINISHED_CASE} is finished but has no saved copy, so we cannot show which value it used.`,
    link: null,
  },
  FINISHED_CASE_KEPT: {
    why: `${FINISHED_CASE} is finished. It keeps the earlier value exactly as it was.`,
    link: null,
  },
  AGENCY_ACCEPTED_EARLIER_FINISHED_WORK: {
    why: `${AGENCY_A} accepted the earlier answer on ${DECIDED_DAY}. That record stays exactly as it was.`,
    link: null,
  },
  LIVE_CASE_FOLLOWS_CURRENT: {
    why: `${OTHER_LIVE_CASE} uses your current details, so it already has the new value.`,
    link: null,
  },
  SHARE_ALREADY_COVERS: {
    why: `${AGENCY_B} can open your current records under the sharing you set up. This change sends them nothing.`,
    link: null,
  },
  AGENCY_HOLDS_CURRENT: {
    why: `You already sent ${AGENCY_B} the current value.`,
    link: null,
  },
};

function expectRows(impact: ChangeImpact, rows: Partial<Record<ImpactReason, Expected>>) {
  const host = dom(html(impact));
  expect(Object.keys(rows).sort()).toEqual([...new Set(impact.items.map((i) => i.reason))].sort());
  for (const [reason, expected] of Object.entries(rows) as [ImpactReason, Expected][]) {
    const li = row(host, reason);
    expect(words(li.querySelector('.ci-why')), reason).toBe(expected.why);
    const links = [...li.querySelectorAll('a')];
    if (!expected.link) {
      expect(links, `${reason} offers no link`).toHaveLength(0);
      continue;
    }
    expect(links, `${reason} offers one link`).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe(expected.link[0]);
    expect(words(links[0])).toBe(expected.link[1]);
    // The link's name is the same on every row, so each one points at what it is about.
    const about = links[0]?.getAttribute('aria-describedby');
    expect(about && words(host.querySelector(`[id="${about}"]`))).toBeTruthy();
  }
}

describe('the made-up reviews', () => {
  it('hold every reason at least once, in both kinds of change and both phases', () => {
    const reasons = new Set(
      Object.values(ALL_REVIEWS).flatMap((one) => one.items.map((i) => i.reason)),
    );
    expect([...reasons].sort()).toEqual(Object.keys(IMPACT_REASON_OUTCOME).sort());
    const kinds = Object.values(ALL_REVIEWS).map((one) => `${one.subject.kind}:${one.phase}`);
    expect(new Set(kinds)).toEqual(
      new Set(['DOCUMENT:RECORDED', 'DOCUMENT:PREVIEW', 'DETAIL:RECORDED']),
    );
    expect(QUIET_EMPTY.quiet && QUIET_WITH_HISTORY.quiet).toBe(true);
    expect(DETAIL_INCOMPLETE.complete).toBe(false);
  });
});

describe('each reason has its own sentence and the right link', () => {
  it('for a replaced document', () => expectRows(DOCUMENT_RECORDED, DOCUMENT_ROWS));
  it('for a changed detail', () => expectRows(DETAIL_RECORDED, DETAIL_ROWS));

  it('names the part of the record that could not be checked, with no link', () => {
    const host = dom(html(DETAIL_INCOMPLETE));
    const rows = [...host.querySelectorAll('li[data-reason="COULD_NOT_CHECK"]')];
    expect(rows.map((li) => words(li.querySelector('.ci-why')))).toEqual([
      'We could not check your requests from agencies this time. Try again in a moment.',
      'We could not check your sharing this time. Try again in a moment.',
    ]);
    expect(rows.map((li) => words(li.querySelector('.ci-about')))).toEqual([
      'Could Not Check Requests from Agencies',
      'Could Not Check Your Sharing',
    ]);
    expect(rows.flatMap((li) => [...li.querySelectorAll('a, button')])).toHaveLength(0);
  });

  it('words a preview as what will happen, never as done', () => {
    const host = dom(html(DOCUMENT_PREVIEW));
    expect(words(row(host, 'LIVE_CASE_USES_REPLACED_DOCUMENT').querySelector('.ci-why'))).toBe(
      `${LIVE_CASE} uses this document. After you replace it, the case will ask you to choose the document it should use and to confirm it again.`,
    );
    expect(words(row(host, 'AGENCY_CHECKING_EARLIER').querySelector('.ci-why'))).toBe(
      `${AGENCY_A} is still checking the copy you sent on ${SENT_DAY}. Replacing this document does not send them the newer one.`,
    );
    expect(words(row(host, 'SHARE_COVERS_EARLIER_ONLY').querySelector('.ci-why'))).toBe(
      `${AGENCY_B} can open this document because you shared it by name. Replacing it does not share the newer document with them. Nothing changes unless you change it in sharing.`,
    );
    expect(words(row(host, 'FINISHED_CASE_KEPT').querySelector('.ci-why'))).toBe(
      `${FINISHED_CASE} is finished. It keeps its own copy exactly as it is.`,
    );
    expect(words(host.querySelector('.ci-intro'))).toBe(
      'If you replace Sample Passport 2019 with Sample Passport 2026, this is what it will mean for your cases, the copies you sent to agencies and your sharing.',
    );
    expect(words(host)).not.toMatch(/was not sent|You replaced|earlier/);
  });

  it('uses a sentence without a date when the date was never recorded, never an empty slot', () => {
    const host = dom(html(DOCUMENT_UNDATED));
    expect(words(row(host, 'AGENCY_WAITING_FOR_REPLACEMENT').querySelector('.ci-why'))).toBe(
      `${AGENCY_A} sent back what you sent and is waiting for your answer. Nothing is sent until you answer it.`,
    );
    expect(words(row(host, 'AGENCY_CHECKING_EARLIER').querySelector('.ci-why'))).toBe(
      `${AGENCY_A} is still checking the earlier copy you sent. The newer one was not sent.`,
    );
    expect(words(row(host, 'SENT_BEFORE_EXACT_VERSIONS').querySelector('.ci-why'))).toBe(
      `You answered ${AGENCY_A} before exact copies were kept. We cannot tell which copy was sent.`,
    );
    // Shared some other way than by name: the sentence does not claim it was by name.
    expect(words(row(host, 'SHARE_COVERS_EARLIER_ONLY').querySelector('.ci-why'))).toBe(
      `${AGENCY_B} can open the earlier document under the sharing you set up. The newer document is not shared with them. Nothing changes unless you change it in sharing.`,
    );
    expect(words(host.querySelector('.ci-intro'))).toBe(
      'This is what replacing Sample Passport 2019 means for your cases, the copies you sent to agencies and your sharing.',
    );
  });

  it('leaves no unfilled slot, in any review', () => {
    for (const [name, impact] of Object.entries(ALL_REVIEWS)) {
      const text = words(dom(html(impact)));
      expect(text, name).not.toMatch(/[{}]|undefined|null|Invalid Date| on \.| on ,/);
    }
  });

  it('says "copy" for a document and "value" for a detail', () => {
    expect(words(dom(html(DOCUMENT_RECORDED)))).not.toMatch(/\bvalues?\b|\banswer you sent\b/);
    const detail = [...dom(html(DETAIL_RECORDED)).querySelectorAll('.ci-why')]
      .map(words)
      .filter((line) => !/before exact copies were kept|no saved copy/.test(line));
    expect(detail.join(' ')).not.toMatch(/\bcop(y|ies)\b|\bdocument\b/);
  });
});

describe('sections', () => {
  it('follow the agreed order, which is the order of the contract', () => {
    expect(SECTION_ORDER).toEqual(IMPACT_OUTCOMES);
    const host = dom(html(DOCUMENT_RECORDED));
    expect(
      [...host.querySelectorAll('[data-outcome]')].map((s) => s.getAttribute('data-outcome')),
    ).toEqual(IMPACT_OUTCOMES);
    expect([...host.querySelectorAll('h2, h3, summary')].map(words)).toEqual([
      'What This Change Affects',
      'Needs Your Action',
      'Worth a Look',
      'We Cannot Tell',
      'Stays as It Was',
      'Nothing to Do (2)',
    ]);
  });

  it('puts every item under its own outcome, even if the list arrives out of order', () => {
    const shuffled = { ...DOCUMENT_RECORDED, items: [...DOCUMENT_RECORDED.items].reverse() };
    const host = dom(html(shuffled));
    for (const section of host.querySelectorAll('[data-outcome]')) {
      const outcome = section.getAttribute('data-outcome');
      for (const li of section.querySelectorAll('li')) {
        const reason = li.getAttribute('data-reason') as ImpactReason;
        expect(IMPACT_REASON_OUTCOME[reason]).toBe(outcome);
      }
    }
    expect(host.querySelectorAll('li')).toHaveLength(DOCUMENT_RECORDED.items.length);
  });

  it('shows only sections that hold something', () => {
    const host = dom(html(DETAIL_INCOMPLETE));
    expect(
      [...host.querySelectorAll('[data-outcome]')].map((s) => s.getAttribute('data-outcome')),
    ).toEqual(['ACTION_REQUIRED', 'UNKNOWN']);
  });

  it('folds away what needs nothing, closed', () => {
    const host = dom(html(DOCUMENT_RECORDED));
    const fold = host.querySelector('details');
    expect(fold?.getAttribute('data-outcome')).toBe('NO_ACTION');
    expect(fold?.hasAttribute('open')).toBe(false);
    expect(fold?.querySelectorAll('li')).toHaveLength(2);
    expect(host.querySelectorAll('details')).toHaveLength(1);
  });

  it('says who or what each item is about', () => {
    const host = dom(html(DOCUMENT_RECORDED));
    expect(words(row(host, 'LIVE_CASE_USES_REPLACED_DOCUMENT').querySelector('.ci-about'))).toBe(
      `Case ${LIVE_CASE}`,
    );
    expect(words(row(host, 'FINISHED_CASE_KEPT').querySelector('.ci-about'))).toBe(
      `Finished Case ${FINISHED_CASE}`,
    );
    const waiting = row(host, 'AGENCY_WAITING_FOR_REPLACEMENT');
    expect(words(waiting.querySelector('.ci-about'))).toBe(`Agency ${AGENCY_A}`);
    expect(words(waiting.querySelector('.ci-about-case'))).toBe(`For the case ${LIVE_CASE}`);
    expect(
      row(host, 'AGENCY_ACCEPTED_EARLIER_FINISHED_WORK').querySelector('.ci-about-case'),
    ).toBeNull();
    expect(words(row(host, 'SHARE_COVERS_EARLIER_ONLY').querySelector('.ci-about'))).toBe(
      `Shared With ${AGENCY_B}`,
    );
  });
});

describe('a finished or settled record never gets a way to act', () => {
  it('renders no link or button under Stays as It Was or Nothing to Do, whatever the item carries', () => {
    const pushy = review(DETAIL_SUBJECT, 'RECORDED', [
      item(
        'LIVE_CASE_CONFIRMATION_VOID',
        { kind: 'CASE', missionId: 'm-1', title: LIVE_CASE, live: true },
        { kind: 'OPEN_CASE', missionId: 'm-1' },
      ),
      item(
        'FINISHED_CASE_KEPT',
        { kind: 'CASE', missionId: 'm-2', title: FINISHED_CASE, live: false },
        { kind: 'OPEN_CASE', missionId: 'm-2' },
      ),
      item('AGENCY_ACCEPTED_EARLIER_FINISHED_WORK', request(), {
        kind: 'OPEN_REQUEST',
        requestId: 'r-1',
      }),
      item('SHARE_ALREADY_COVERS', share(), { kind: 'OPEN_SHARING', grantId: 'g-1' }),
      item('AGENCY_HOLDS_CURRENT', request({ requestId: 'r-9' }), {
        kind: 'OPEN_REQUEST',
        requestId: 'r-9',
      }),
    ]);
    const host = dom(html(pushy));
    for (const outcome of ['HISTORY_PRESERVED', 'NO_ACTION']) {
      const section = host.querySelector(`[data-outcome="${outcome}"]`);
      expect(section?.querySelectorAll('li').length).toBeGreaterThan(0);
      expect(section?.querySelectorAll('a, button, input, form')).toHaveLength(0);
    }
    expect(host.querySelectorAll('a')).toHaveLength(1);
  });

  it('performs nothing anywhere: links only, and the closing line says so', () => {
    for (const impact of Object.values(ALL_REVIEWS)) {
      const host = dom(html(impact));
      expect(host.querySelectorAll('button, form, input, select, textarea')).toHaveLength(0);
      expect(words(host.querySelector('.ci-closing'))).toBe(
        'This list sends, shares and changes nothing. Each step happens in the case, the request or sharing, and only when you choose it.',
      );
    }
  });
});

describe('a quiet change', () => {
  it('gets one calm line and no alert', () => {
    const markup = html(QUIET_EMPTY);
    const host = dom(markup);
    expect(words(host.querySelector('.ci-quiet'))).toBe(
      'Nothing else uses this. No action is needed.',
    );
    expect(host.querySelectorAll('li, [data-outcome]')).toHaveLength(0);
    expect(markup).not.toMatch(/role="alert"|aria-live="assertive"|role="status"/);
    expect(words(host.querySelector('.ci-intro'))).toBe(
      'This is what a change to Employer Name means for your cases, your answers to agencies and your sharing.',
    );
  });

  it('does not say nothing uses it when finished or settled records relate to it', () => {
    const host = dom(html(QUIET_WITH_HISTORY));
    expect(words(host.querySelector('.ci-quiet'))).toBe(
      'No action is needed. What relates to this change is listed below.',
    );
    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(host.querySelectorAll('a')).toHaveLength(0);
  });

  it('never raises an alert in any review, and a change that is not quiet has no calm line', () => {
    for (const impact of Object.values(ALL_REVIEWS)) {
      const markup = html(impact);
      expect(markup).not.toMatch(/role="alert"|aria-live="assertive"/);
      expect(dom(markup).querySelectorAll('.ci-quiet')).toHaveLength(impact.quiet ? 1 : 0);
    }
  });
});

describe('a review that could not check everything', () => {
  it('says so, and only then', () => {
    expect(words(dom(html(DETAIL_INCOMPLETE)).querySelector('.ci-incomplete'))).toBe(
      'We could not check everything this time, so this list may be missing something. Try again in a moment.',
    );
    expect(dom(html(DETAIL_RECORDED)).querySelector('.ci-incomplete')).toBeNull();
  });
});

describe('honest wording', () => {
  const emDash = String.fromCodePoint(0x2014);
  const forbidden =
    /\bseen\b|\bviewed\b|\bread by\b|\brelied\b|\bmust\b|\bguarantee|\bwill be accepted\b/i;

  it('never claims a recipient looked at or depended on anything, in any sentence', () => {
    for (const [key, text] of Object.entries(changeImpactCatalog.en)) {
      expect(text, key).not.toMatch(forbidden);
      expect(text.includes(emDash), key).toBe(false);
      expect(text, key).not.toMatch(/\bmissions?\b/i);
    }
    for (const [name, impact] of Object.entries(ALL_REVIEWS)) {
      expect(words(dom(html(impact))), name).not.toMatch(forbidden);
    }
  });

  it('says a recipient can open a record, and that a newer copy or value was not sent', () => {
    const text = words(dom(html(DOCUMENT_RECORDED)));
    expect(text).toContain('can open the earlier document');
    expect(text).toContain('The newer one was not sent');
    expect(text).not.toMatch(/\bopened\b|\bhas the newer\b|\bdownloaded\b/);
  });

  it('writes every name in Title Case and keeps sentences as sentences', () => {
    const names = Object.entries(changeImpactCatalog.en).filter(([key]) =>
      /^changeImpact\.(about\.(?!forCase)|section\.|step\.|notice\.(title|link)|review\.title|view\.(failedTitle|tryAgain))/.test(
        key,
      ),
    );
    expect(names.length).toBe(22);
    for (const [key, text] of names) expect(isTitleCase(text), `${key}: ${text}`).toBe(true);
  });
});

describe('the title and its levels', () => {
  it('fits under the heading of the place it is shown in', () => {
    const panel = dom(html(DOCUMENT_PREVIEW, { titleLevel: 4 }));
    expect(words(panel.querySelector('h4'))).toBe('What This Change Affects');
    expect(panel.querySelectorAll('h5')).toHaveLength(4);
    expect(panel.querySelectorAll('h2, h3')).toHaveLength(0);
  });

  it('leaves the title to the page header when asked, and still names the region', () => {
    const page = dom(html(DOCUMENT_RECORDED, { withTitle: false }));
    expect(page.querySelector('.ci-title')).toBeNull();
    expect(page.querySelector('.ci-review')?.getAttribute('aria-label')).toBe(
      'What This Change Affects',
    );
    expect(page.querySelectorAll('h2')).toHaveLength(4);
  });

  it('gives every id once, also with two reviews on one screen', () => {
    const both = dom(html(DOCUMENT_RECORDED) + html(DETAIL_RECORDED, { idPrefix: 'second' }));
    const ids = [...both.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the short notice under a saved detail', () => {
  const notice = (impact: ChangeImpact) =>
    renderToStaticMarkup(
      <ChangeImpactNotice summary={changeImpactSummary(impact, APPLICANT_ID)} t={t} />,
    );

  it('shows nothing at all for a quiet change', () => {
    expect(changeImpactSummary(QUIET_EMPTY, APPLICANT_ID)).toBeNull();
    expect(notice(QUIET_EMPTY)).toBe('');
    expect(notice(QUIET_WITH_HISTORY)).toBe('');
    expect(
      renderToStaticMarkup(
        <ChangeImpactNotice
          summary={{ href: '/x', actionRequired: 0, reviewRecommended: 0, unknown: 0 }}
          t={t}
        />,
      ),
    ).toBe('');
  });

  it('gives the title, the counts in words and a link to the full list', () => {
    const markup = notice(DETAIL_RECORDED);
    const host = dom(markup);
    expect(words(host)).toBe(
      'What This Change Affects 2 items need your action. 2 items are worth a look. We cannot tell about 2 items. See the Full List',
    );
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      `/app/applicant/${APPLICANT_ID}/change-impact?detail=f-employer`,
    );
    // Announced politely: an output, never an alert.
    expect(host.firstElementChild?.tagName).toBe('OUTPUT');
    expect(markup).not.toMatch(/role="alert"|aria-live="assertive"/);
  });

  it('counts one thing as one, and leaves out what is zero', () => {
    expect(words(dom(notice(DETAIL_INCOMPLETE)))).toBe(
      'What This Change Affects 1 item needs your action. We cannot tell about 2 items. See the Full List',
    );
    const one = review(DETAIL_SUBJECT, 'RECORDED', [
      item('AGENCY_CHECKING_EARLIER', request()),
      item('SENT_BEFORE_EXACT_VERSIONS', request({ requestId: 'r-2' })),
    ]);
    expect(words(dom(notice(one)))).toBe(
      'What This Change Affects 1 item is worth a look. We cannot tell about 1 item. See the Full List',
    );
  });

  it('addresses a document and a detail by their own ids', () => {
    expect(changeImpactHref('a 1', { kind: 'DOCUMENT', id: 'd/1' })).toBe(
      '/app/applicant/a%201/change-impact?document=d%2F1',
    );
    expect(changeImpactSummary(DOCUMENT_RECORDED, APPLICANT_ID)?.href).toBe(
      `/app/applicant/${APPLICANT_ID}/change-impact?document=d-old`,
    );
  });
});

describe('when the list did not load', () => {
  it('says nothing was changed and offers the same address again', () => {
    const href = changeImpactHref(APPLICANT_ID, { kind: 'DETAIL', id: 'f-employer' });
    const host = dom(renderToStaticMarkup(<ChangeImpactFailed retryHref={href} t={t} />));
    expect(words(host.querySelector('h2'))).toBe('This List Did Not Load');
    expect(words(host)).toContain('Nothing in your records was changed.');
    expect(host.querySelector('a')?.getAttribute('href')).toBe(href);
    expect(words(host.querySelector('a'))).toBe('Try Again');
  });
});

describe('accessibility scan', () => {
  it('finds nothing in any review, in the notice or in the failed state', async () => {
    for (const [name, impact] of Object.entries(ALL_REVIEWS)) {
      expect(await axeViolations(html(impact)), name).toEqual([]);
      expect(await axeViolations(html(impact, { withTitle: false })), name).toEqual([]);
    }
    expect(
      await axeViolations(
        renderToStaticMarkup(
          <ChangeImpactNotice summary={changeImpactSummary(DETAIL_RECORDED, APPLICANT_ID)} t={t} />,
        ),
      ),
    ).toEqual([]);
    expect(
      await axeViolations(renderToStaticMarkup(<ChangeImpactFailed retryHref="/x" t={t} />)),
    ).toEqual([]);
  });
});

// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ChangeImpact, IMPACT_OUTCOMES, type ImpactOutcome } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { changeImpactCatalog } from '../../../../../i18n/change-impact';
import { axeViolations } from '../../../../../lib/axe.test-support';
import { partsTranslator } from '../../../../../lib/language-parts';
import '../../../../../lib/next-mocks.test-support';
import { ChangeImpactNotice } from './change-impact-notice';
import { ChangeImpactReview } from './change-impact-review';
import { SECTION_HEADINGS, changeImpactSummary } from './impact-words';

/**
 * The review drawn from the service's own recorded results (the golden files the service checks
 * against the real records), not from made-up reviews written beside the screen. If the service
 * changes what it returns, these files change, and this test shows what a person would then read.
 */

const GOLDEN = join(
  process.cwd(),
  '..',
  '..',
  'packages',
  'services',
  'src',
  'change-impact',
  'golden',
);
const DATE_FIELDS = new Set(['assessedAt', 'changedAt', 'sentAt', 'decidedAt']);

function golden(name: string): ChangeImpact {
  return JSON.parse(readFileSync(join(GOLDEN, `${name}.json`), 'utf8'), (key, value) =>
    DATE_FIELDS.has(key) && typeof value === 'string' ? new Date(value) : value,
  ) as ChangeImpact;
}

const t = partsTranslator(changeImpactCatalog, 'en', 'en');
const APPLICANT = 'a1';

function render(impact: ChangeImpact): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <ChangeImpactReview impact={impact} applicantId={APPLICANT} t={t} locale="en" />,
  );
  return host;
}

const words = (node: Element | null | undefined) =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The sentences under one outcome, as drawn. */
function under(host: HTMLElement, outcome: ImpactOutcome): string[] {
  const section = host.querySelector(`[data-outcome="${outcome}"]`);
  return [...(section?.querySelectorAll('.ci-why') ?? [])].map(words);
}

/** The headings a file's own outcomes call for, in the agreed order. */
function expectedHeadings(impact: ChangeImpact): string[] {
  return IMPACT_OUTCOMES.filter((outcome) => impact.items.some((i) => i.outcome === outcome)).map(
    (outcome) => t(SECTION_HEADINGS[outcome]),
  );
}

function drawnHeadings(host: HTMLElement): string[] {
  return [...host.querySelectorAll('.ci-section-title, .ci-fold-summary')].map((node) =>
    words(node).replace(/ \(\d+\)$/, ''),
  );
}

describe.each(['document-preview', 'document-recorded', 'detail-recorded', 'quiet'])(
  'the recorded result %s',
  (name) => {
    const impact = golden(name);
    const host = render(impact);

    it('draws one row per item, under the headings its own outcomes call for', () => {
      expect(impact.assessedAt).toBeInstanceOf(Date);
      expect(host.querySelectorAll('li')).toHaveLength(impact.items.length);
      expect(drawnHeadings(host)).toEqual(expectedHeadings(impact));
      for (const outcome of IMPACT_OUTCOMES) {
        expect(under(host, outcome), outcome).toHaveLength(
          impact.items.filter((i) => i.outcome === outcome).length,
        );
      }
    });

    it('leaves no gap in any sentence and passes the accessibility scan', async () => {
      expect(words(host)).not.toMatch(/[{}]|undefined|null|Invalid Date/);
      expect(words(host)).not.toMatch(/\bseen\b|\bviewed\b|\bread by\b|\brelied\b|\bmust\b/i);
      expect(await axeViolations(host.innerHTML)).toEqual([]);
    });
  },
);

describe('a replaced document, as the service recorded it', () => {
  const host = render(golden('document-recorded'));

  it('puts exactly the live case under Needs Your Action, with the link to that case', () => {
    expect(under(host, 'ACTION_REQUIRED')).toEqual([
      'Sample Live Case still uses the earlier document. Open the case, choose the document it should use, then confirm the case again.',
    ]);
    const links = [...host.querySelectorAll('[data-outcome="ACTION_REQUIRED"] a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/app/mission/%3Ccase%3Alive%3E']);
  });

  it('puts the accepted earlier copy and the share by name under Worth a Look', () => {
    const lines = under(host, 'REVIEW_RECOMMENDED');
    expect(lines).toHaveLength(2);
    expect(
      lines.some((line) =>
        /^Sample Agency A accepted the earlier copy you sent on \d{1,2} Nov 2026, and their work with you is still in progress\. The accepted copy stays exactly as sent\. The newer one was not sent to them\.$/.test(
          line,
        ),
      ),
    ).toBe(true);
    expect(lines).toContain(
      'Sample Agency B can open the earlier document because you shared it by name. The newer document is not shared with them. Nothing changes unless you change it in sharing.',
    );
  });

  it('puts the finished case under Stays as It Was, with nothing to press', () => {
    expect(under(host, 'HISTORY_PRESERVED')).toEqual([
      'Sample Finished Case is finished. It keeps the earlier copy exactly as it was.',
    ]);
    expect(host.querySelectorAll('[data-outcome="HISTORY_PRESERVED"] a, button')).toHaveLength(0);
    expect(host.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('names both documents in the opening line', () => {
    expect(words(host.querySelector('.ci-intro'))).toBe(
      'You replaced sample-passport-older.pdf with sample-passport-newer.pdf. This is what that means for your cases, the copies you sent to agencies and your sharing.',
    );
  });
});

describe('the same document before it is replaced', () => {
  it('says what will happen, for the same records', () => {
    const host = render(golden('document-preview'));
    expect(under(host, 'ACTION_REQUIRED')).toEqual([
      'Sample Live Case uses this document. After you replace it, the case will ask you to choose the document it should use and to confirm it again.',
    ]);
    expect(words(host)).not.toMatch(/You replaced|was not sent/);
  });
});

describe('a changed detail, as the service recorded it', () => {
  const impact = golden('detail-recorded');
  const host = render(impact);

  it('shows the case confirmation, the accepted earlier answer and the finished case', () => {
    expect(under(host, 'ACTION_REQUIRED')).toEqual([
      'You confirmed Sample Live Case with the earlier value. That confirmation no longer counts. Open the case and confirm it again.',
    ]);
    const [accepted] = under(host, 'REVIEW_RECOMMENDED');
    expect(accepted).toMatch(
      /^Sample Agency A accepted the earlier answer you sent on \d{1,2} Nov 2026, and their work with you is still in progress\. The accepted answer stays exactly as sent\. The new value was not sent to them\.$/,
    );
    expect(under(host, 'HISTORY_PRESERVED')).toEqual([
      'Sample Finished Case is finished. It keeps the earlier value exactly as it was.',
    ]);
    expect(words(host.querySelector('.ci-intro'))).toMatch(
      /^You changed Current Employer on \d{1,2} Nov 2026\./,
    );
  });

  it('gives the saved-detail notice the counts the file holds', () => {
    const summary = changeImpactSummary(impact, APPLICANT);
    expect(summary).toMatchObject({
      actionRequired: impact.counts.ACTION_REQUIRED,
      reviewRecommended: impact.counts.REVIEW_RECOMMENDED,
      unknown: impact.counts.UNKNOWN,
    });
    const notice = renderToStaticMarkup(<ChangeImpactNotice summary={summary} t={t} />);
    expect(notice).toContain('needs your action');
    expect(notice).not.toContain('We cannot tell');
  });
});

describe('the control change that affects nothing', () => {
  const impact = golden('quiet');
  const host = render(impact);

  it('raises no alert, offers no link and shows no notice', () => {
    expect(impact.quiet).toBe(true);
    expect(host.innerHTML).not.toMatch(/role="alert"|aria-live="assertive"/);
    expect(host.querySelectorAll('a, button')).toHaveLength(0);
    expect(words(host.querySelector('.ci-quiet'))).toBe(
      'No action is needed. What relates to this change is listed below.',
    );
    expect(changeImpactSummary(impact, APPLICANT)).toBeNull();
    expect(
      renderToStaticMarkup(
        <ChangeImpactNotice summary={changeImpactSummary(impact, APPLICANT)} t={t} />,
      ),
    ).toBe('');
  });
});

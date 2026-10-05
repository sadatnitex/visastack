import type { PublicTrustRoute } from '@visastack/services';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The public trust page links out to three kinds of author-typed URL: the
 * official application channel, the official reporting channel and each cited
 * source. Writes are validated (packs.test.ts), but the page must also refuse
 * to link a stored value that is not an absolute http(s) URL, since rows
 * written before that check, or edited in the database, are still served here.
 */

const getPublicTrustRoute = vi.fn();

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getPublicTrustRoute: (...args: unknown[]) => getPublicTrustRoute(...args),
}));
vi.mock('../../../lib/public-db', () => ({
  withPublicDb: async (fn: (db: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => (
    <a href={href} {...rest}>
      {children as never}
    </a>
  ),
}));

const { default: PublicTrustRoutePage } = await import('./page');

function route(overrides: Partial<PublicTrustRoute> = {}): PublicTrustRoute {
  return {
    packKey: 'uk.standard-visitor',
    packName: 'UK Standard Visitor',
    jurisdiction: 'United Kingdom',
    route: 'Visit',
    purpose: 'Tourism',
    routeDescription: 'Short tourist stays.',
    version: 3,
    effectiveDate: null,
    nextReviewDate: null,
    officialFee: null,
    officialChannelName: 'UK Visas and Immigration',
    officialChannelUrl: 'https://www.gov.uk/apply-uk-visa',
    officialReportingUrl: 'https://www.gov.uk/report-immigration-crime',
    officialSources: [
      {
        publisher: 'UK Home Office',
        sourceTitle: 'Standard Visitor visa',
        sourceUrl: 'https://www.gov.uk/standard-visitor',
      },
    ],
    ...overrides,
  };
}

async function render(value: PublicTrustRoute): Promise<string> {
  getPublicTrustRoute.mockResolvedValue(value);
  const element = (await PublicTrustRoutePage({
    params: Promise.resolve({ packKey: value.packKey }),
  })) as ReactElement;
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  getPublicTrustRoute.mockReset();
});

describe('public trust page links', () => {
  it('links the channel, the reporting page and each source when they are http(s)', async () => {
    const html = await render(route());
    expect(html).toContain('href="https://www.gov.uk/apply-uk-visa"');
    expect(html).toContain('href="https://www.gov.uk/report-immigration-crime"');
    expect(html).toContain('href="https://www.gov.uk/standard-visitor"');
    expect(html).toContain('official reporting channel');
    // Every external link keeps its opener and referrer protections.
    expect(html.match(/target="_blank"/g)).toHaveLength(3);
    expect(html.match(/rel="noreferrer"/g)).toHaveLength(3);
  });

  it.each([
    'javascript:alert(document.cookie)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    '/relative/path',
    'see the official website',
  ])('renders no link at all for a stored value of %j', async (stored) => {
    const html = await render(
      route({
        officialChannelUrl: stored,
        officialReportingUrl: stored,
        officialSources: [
          { publisher: 'UK Home Office', sourceTitle: 'Guidance', sourceUrl: stored },
        ],
      }),
    );
    expect(html).not.toMatch(/href="(javascript|data|file):/i);
    expect(html).not.toContain(`href="${stored}"`);
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain('official reporting channel');
    // The channel card falls back to the "not on file" text rather than a dead button.
    expect(html).toContain('Not yet on file for this route.');
    // The source's name still shows; only its link is withheld.
    expect(html).toContain('UK Home Office');
  });

  it('refuses the unsafe links individually, keeping the safe ones', async () => {
    const html = await render(
      route({
        officialChannelUrl: 'javascript:alert(1)',
        officialSources: [
          { publisher: 'A', sourceTitle: 'Safe', sourceUrl: 'https://www.gov.uk/safe' },
          { publisher: 'B', sourceTitle: 'Unsafe', sourceUrl: 'javascript:alert(2)' },
        ],
      }),
    );
    expect(html).toContain('href="https://www.gov.uk/safe"');
    expect(html).toContain('href="https://www.gov.uk/report-immigration-crime"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('href="https://www.gov.uk/apply-uk-visa"');
  });
});

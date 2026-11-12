import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import TermsPage from './page';

const beta = vi.hoisted(() => ({ open: true }));
vi.mock('../../lib/public-beta', () => ({ isPublicBetaOpen: () => beta.open }));
afterEach(() => {
  beta.open = true;
});

it('in public beta mode keeps the own-risk wording and not the made-up-details rule', () => {
  beta.open = true;
  const html = renderToStaticMarkup(<TermsPage />);
  expect(html).toContain('You may use your own details and documents, at your own risk');
  expect(html).not.toContain('Real applicant details are not accepted yet');
});

it('in pilot mode repeats the made-up-details rule and does not invite real details', () => {
  beta.open = false;
  const html = renderToStaticMarkup(<TermsPage />);
  expect(html).toContain('Please use made-up details');
  expect(html).toContain('Real applicant details are not accepted yet');
  expect(html).not.toContain('You may use your own details and documents');
});

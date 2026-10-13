import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ requestEvidenceAction: vi.fn() }));

const { RequestEvidenceForm } = await import('./request-evidence-form');

const html = renderToStaticMarkup(
  <RequestEvidenceForm
    organizationId="org-1"
    applicants={[{ applicantId: 'a-1', displayName: 'Test Applicant' }]}
  />,
);
const visibleText = html.replace(/<[^>]*>/g, '|');

describe('RequestEvidenceForm wording', () => {
  it('shows plain words and no stored codes as visible text', () => {
    expect(visibleText).toContain('What do you need?');
    expect(visibleText).toContain('A detail from the profile');
    expect(visibleText).toContain('Passport number');
    expect(visibleText).not.toMatch(/passport_number|bank_statement|Field key/);
  });

  it('still submits the stored code for the chosen detail', () => {
    expect(html).toContain('value="passport_number"');
    expect(html).toContain('name="key"');
  });
});

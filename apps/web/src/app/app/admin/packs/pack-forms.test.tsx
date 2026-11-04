import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';

vi.mock('./actions', () => ({
  addRequirementAction: vi.fn(),
  createPackAction: vi.fn(),
  recordRequirementSourceReviewAction: vi.fn(),
  setDocumentExpiryPolicyAction: vi.fn(),
  setPublicTrustContentAction: vi.fn(),
  verifyChecksumAction: vi.fn(),
}));

const { CreatePackForm } = await import('./pack-forms');

/** VS-006: Pack Studio says what makes a case find a pack, in the words a case uses. */
describe('CreatePackForm', () => {
  const html = renderToStaticMarkup(<CreatePackForm />);

  it('asks for the destination country, not a jurisdiction, and says it is not the embassy', () => {
    expect(html).toContain('Destination Country');
    expect(html).not.toContain('Jurisdiction');
    expect(html).toContain('not the embassy where they apply');
    expect(html).toContain('name="jurisdiction"');
  });

  it('says which details decide whether a case finds the pack', () => {
    expect(html).toContain('A case finds a pack by the country it travels to');
    expect(html).toContain('authoritative');
    expect(html).toContain('a case that names its purpose never finds');
    expect(html).toContain('Purpose (Optional)');
    expect(html).toContain('Destination Country (Optional)');
    // An agency case owner can pick that agency's own pack, so the help does not say only
    // authoritative packs are ever picked.
    expect(html).not.toContain('Only a pack marked authoritative');
    expect(html).toContain('is offered only to that agency');
  });

  it('has no accessibility violations', async () => {
    expect(await axeViolations(html)).toEqual([]);
  });
});

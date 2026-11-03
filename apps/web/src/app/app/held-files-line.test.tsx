import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HeldFilesLine, heldFilesLabel } from './held-files-line';

describe('UMPE G4: N Files Need a Person', () => {
  it('shows one line linking to the decision list while files wait', () => {
    const html = renderToStaticMarkup(<HeldFilesLine applicantId="a1" count={3} />);
    expect(html).toContain('3 Files Need a Person');
    expect(html).toContain('href="/app/applicant/a1/documents#needs-decision"');
    expect(heldFilesLabel(1)).toBe('1 File Needs a Person');
  });

  it('shows nothing when no file waits or there is nobody to link to', () => {
    expect(renderToStaticMarkup(<HeldFilesLine applicantId="a1" count={0} />)).toBe('');
    expect(renderToStaticMarkup(<HeldFilesLine applicantId={undefined} count={2} />)).toBe('');
  });
});

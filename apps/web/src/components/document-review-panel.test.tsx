import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentReviewPanel } from './document-review-panel';

describe('document review without exposing bytes', () => {
  const previewAction = async () => undefined;
  it('does not offer previews for unchecked or rejected documents', () => {
    const html = renderToStaticMarkup(
      <DocumentReviewPanel
        applicantId="a1"
        previewAction={previewAction}
        documents={[
          {
            id: 'd1',
            name: 'Synthetic passport',
            safetyLabel: 'Quarantined',
            safetyTone: 'danger',
            processingLabel: 'Processing',
            previewAllowed: false,
          },
        ]}
      />,
    );
    expect(html).toContain('This document is not available to preview');
    expect(html).toContain('badge-danger');
    expect(html).toContain('type="search"');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<object');
  });
  it('passes the selected authorized identifiers to the existing action', () => {
    const html = renderToStaticMarkup(
      <DocumentReviewPanel
        applicantId="a1"
        previewAction={previewAction}
        documents={[
          {
            id: 'd2',
            name: 'Synthetic statement',
            safetyLabel: 'Safety checks passed',
            safetyTone: 'success',
            processingLabel: 'Ready',
            previewAllowed: true,
          },
        ]}
      />,
    );
    expect(html).toContain('Open Secure Preview');
    expect(html).toContain('name="documentId" value="d2"');
    expect(html).toContain('name="applicantId" value="a1"');
    expect(html).not.toContain('<iframe');
  });
  it('shows a useful empty state', () => {
    const html = renderToStaticMarkup(
      <DocumentReviewPanel applicantId="a1" previewAction={previewAction} documents={[]} />,
    );
    expect(html).toContain('Upload a document to review its details here');
    expect(html).not.toContain('<form');
  });
});

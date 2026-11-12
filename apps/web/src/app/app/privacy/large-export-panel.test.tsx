import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { LargeExportPanel } from './large-export-panel';

vi.mock('./actions', () => ({ requestLargeExportAction: vi.fn() }));

const words = () => renderToStaticMarkup(<LargeExportPanel jobs={[]} />).replace(/<[^>]*>/g, ' ');

it('describes the ZIP as usable files including earlier copies that passed the format check', () => {
  const text = words().replace(/\s+/g, ' ');
  expect(text).toContain('every usable document file, including earlier copies');
  expect(text).toContain('passed the file format check');
  expect(text).toContain('not scanned for viruses yet');
  expect(text).toContain('24 hours');
});

it('never calls a file safe or limits the ZIP to current copies (a file check is not a virus scan)', () => {
  const text = words();
  expect(text).not.toMatch(/\bsafe\b/i);
  expect(text).not.toContain('every current');
});

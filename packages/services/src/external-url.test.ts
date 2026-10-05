import { describe, expect, it } from 'vitest';
import { isHttpUrl, safeHttpUrl } from './external-url';

describe('isHttpUrl', () => {
  it.each([
    'https://www.gov.uk/standard-visitor',
    'http://example.org/page?x=1#frag',
    'HTTPS://WWW.GOV.UK/',
    '  https://www.gov.uk/standard-visitor  ',
    'https://localhost:3000/x',
  ])('accepts %j', (value) => {
    expect(isHttpUrl(value)).toBe(true);
  });

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.org/file',
    'mailto:someone@example.org',
    'vbscript:msgbox(1)',
    '//example.org/protocol-relative',
    '/relative/path',
    'www.gov.uk/no-scheme',
    'see the official website',
    'https://',
    'http//missing-colon.example',
  ])('rejects %j', (value) => {
    expect(isHttpUrl(value)).toBe(false);
  });
});

describe('safeHttpUrl', () => {
  it('returns a safe URL trimmed', () => {
    expect(safeHttpUrl('  https://www.gov.uk/x  ')).toBe('https://www.gov.uk/x');
    expect(safeHttpUrl('http://example.org')).toBe('http://example.org');
  });

  it.each([null, undefined, '', '   ', 'javascript:alert(1)', 'data:text/html,x', '/relative'])(
    'returns null for %j, which every call site reads as no link on file',
    (value) => {
      expect(safeHttpUrl(value)).toBeNull();
    },
  );
});

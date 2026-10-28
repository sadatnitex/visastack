import { describe, expect, it } from 'vitest';
import { asciiFileName, blobResponseHeaders } from './headers';

/**
 * Pure header-construction tests (master directive §7 "PR 3") — no storage,
 * no DB, no token verification involved; those are covered separately
 * (packages/adapters' blob-token/storage tests, and the route's own
 * token/variant/not-found branches, which are simple early returns with no
 * independent logic worth mocking a database for).
 */
describe('blobResponseHeaders — the security-relevant response headers for served bytes', () => {
  it('always sets private/no-store caching, nosniff, and a locked-down CSP', () => {
    const headers = blobResponseHeaders({
      contentType: 'application/pdf',
      dispositionKind: 'inline',
      filename: 'passport.pdf',
    });
    expect(headers['Cache-Control']).toBe('private, no-store');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Content-Security-Policy']).toBe("default-src 'none'; sandbox");
  });

  it('passes the declared content type through unchanged', () => {
    const headers = blobResponseHeaders({
      contentType: 'text/markdown',
      dispositionKind: 'inline',
      filename: 'notes.md',
    });
    expect(headers['Content-Type']).toBe('text/markdown');
  });

  it('renders inline vs attachment disposition correctly', () => {
    const inline = blobResponseHeaders({
      contentType: 'application/pdf',
      dispositionKind: 'inline',
      filename: 'a.pdf',
    });
    expect(inline['Content-Disposition']).toContain('inline');
    const attachment = blobResponseHeaders({
      contentType: 'application/pdf',
      dispositionKind: 'attachment',
      filename: 'a.pdf',
    });
    expect(attachment['Content-Disposition']).toContain('attachment');
  });

  it('strips control characters and quotes from an untrusted filename (header-injection guard)', () => {
    const headers = blobResponseHeaders({
      contentType: 'application/pdf',
      dispositionKind: 'inline',
      filename: 'evil"; x=\x00.pdf',
    });
    const disposition = headers['Content-Disposition'] ?? '';
    expect(disposition).not.toContain('\x00');
    // The embedded quote and backslash are stripped, not escaped — so the
    // classic filename="..." segment contains exactly the two quotes that
    // delimit it, never an attacker-supplied one breaking out early.
    expect(disposition).toContain('filename="evil; x=.pdf"');
  });

  it('includes the RFC 5987 filename* form for non-ASCII display names', () => {
    const headers = blobResponseHeaders({
      contentType: 'application/pdf',
      dispositionKind: 'attachment',
      filename: 'pasaporte-jose.pdf',
    });
    expect(headers['Content-Disposition']).toContain("filename*=UTF-8''");
  });

  it('falls back to a bare disposition (no filename params) when no filename is known', () => {
    const headers = blobResponseHeaders({
      contentType: 'application/pdf',
      dispositionKind: 'inline',
      filename: undefined,
    });
    expect(headers['Content-Disposition']).toBe('inline');
  });

  it('serves names outside plain ASCII: a plain filename for old clients, the full name in filename*', () => {
    const names = [
      // "Passport, " then L with stroke and "ukasz"
      `Passport, ${String.fromCodePoint(0x141)}ukasz.pdf`,
      // A Bangla name: "Passport, Nazmus" written in Bangla letters
      `${String.fromCodePoint(0x9aa, 0x9be, 0x9b8, 0x9aa, 0x9cb, 0x9b0, 0x9cd, 0x99f)}, ${String.fromCodePoint(0x9a8, 0x9be, 0x99c, 0x9ae, 0x9c1, 0x9b8)}.pdf`,
      // A curly apostrophe
      `Nazmus${String.fromCodePoint(0x2019)}s Bank Letter.pdf`,
    ];
    for (const name of names) {
      const headers = blobResponseHeaders({
        contentType: 'application/pdf',
        dispositionKind: 'attachment',
        filename: name,
      });
      // The real failure: a header value above U+00FF makes the response itself throw.
      expect(() => new Response('bytes', { headers })).not.toThrow();
      const value = headers['Content-Disposition'] ?? '';
      expect(/^[\x20-\x7e]*$/.test(value)).toBe(true);
      const encoded = value.match(/filename\*=UTF-8''(.+)$/)?.[1] ?? '';
      expect(decodeURIComponent(encoded)).toBe(name);
      expect(encoded).not.toMatch(/['()*!]/);
    }
    expect(asciiFileName(names[0] ?? '')).toBe('Passport, Lukasz.pdf');
    expect(asciiFileName(names[1] ?? '')).toBe('_, _.pdf');
    expect(asciiFileName(names[2] ?? '')).toBe("Nazmus's Bank Letter.pdf");
    expect(
      asciiFileName(`Caf${String.fromCodePoint(0xe9)} Stra${String.fromCodePoint(0xdf)}e`),
    ).toBe('Cafe Strasse');
  });

  it('falls back to "document" when nothing of the name is left in plain letters but marks', () => {
    const headers = blobResponseHeaders({
      contentType: 'image/png',
      dispositionKind: 'inline',
      filename: String.fromCodePoint(0x301, 0x301),
    });
    expect(headers['Content-Disposition']).toContain('filename="document"');
  });
});

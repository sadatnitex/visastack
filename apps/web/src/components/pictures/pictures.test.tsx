// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUE_DOCUMENTS } from '@visastack/core/catalogue/documents';
import { act } from 'react';
import { type Root, createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { axeViolations } from '../../lib/axe.test-support';
import { DOCUMENT_PICTURE_NAMES } from '../../lib/document-picture';
import { DOCUMENT_CANVAS, documentDrawing, hasDocumentDrawing } from './document-drawings';
import { DocumentPicture } from './document-picture';
import { NeutralPassportCover, passportCoverHeight } from './neutral-passport-cover';
import { BANGLADESH_COVER_SRC, COVER_LABELS, PassportCover } from './passport-cover';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PUBLIC = join(__dirname, '..', '..', '..', 'public');

let container: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container.remove();
});

/** Every src, href and xlink:href value in some markup. */
function references(html: string): string[] {
  return [...html.matchAll(/\s(?:src|href|xlink:href|srcset)="([^"]*)"/gi)].map((m) => m[1] ?? '');
}

describe('the real Bangladesh passport cover file', () => {
  const file = readFileSync(join(PUBLIC, 'pictures', 'passport-bd.png'));

  it('is the exact file the owner approved, byte for byte', () => {
    expect(file.length).toBe(27_676);
    expect(createHash('sha256').update(file).digest('hex')).toBe(
      '53aff64a5f0138b13e62ac04ced8a098f7a9d5a84a35fe1d2b9594549751636d',
    );
  });

  it('is a 640 x 910 PNG, the shape the cover is drawn at', () => {
    expect(file.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(file.readUInt32BE(16)).toBe(640);
    expect(file.readUInt32BE(20)).toBe(910);
    expect(BANGLADESH_COVER_SRC).toBe('/pictures/passport-bd.png');
  });
});

describe('DocumentPicture', () => {
  it('draws every document kind as a small inline picture', () => {
    for (const name of DOCUMENT_PICTURE_NAMES) {
      expect(hasDocumentDrawing(name), name).toBe(true);
      const html = renderToString(<svg aria-hidden="true">{documentDrawing(name)}</svg>);
      // Small: a handful of shapes, and nothing fetched.
      expect((html.match(/<(?:path|rect|circle)\b/g) ?? []).length, name).toBeLessThanOrEqual(14);
      expect(html.length, name).toBeLessThan(2_000);
      expect(html, name).not.toMatch(/<(?:image|use|a|foreignObject|text|script)\b/i);
    }
    expect(hasDocumentDrawing('notAPicture')).toBe(false);
    expect(hasDocumentDrawing('toString')).toBe(false);
  });

  it('renders the picture of a known type, in its tone, sized to the sheet', () => {
    const html = renderToString(<DocumentPicture type="PASSPORT" size={80} />);
    expect(html).toContain('data-picture="docPassport"');
    expect(html).toContain('data-tone="blue"');
    expect(html).toContain(`viewBox="0 0 ${DOCUMENT_CANVAS.width} ${DOCUMENT_CANVAS.height}"`);
    expect(html).toContain('width="80"');
    expect(html).toContain('height="100"');
  });

  it('is decoration beside its word, and a named picture when it stands alone', () => {
    const quiet = renderToString(<DocumentPicture type="BANK_STATEMENT" />);
    expect(quiet).toMatch(/^<span[^>]*aria-hidden="true"/);
    expect(quiet).not.toContain('role="img"');
    const named = renderToString(<DocumentPicture type="BANK_STATEMENT" label="Bank Statement" />);
    expect(named).toMatch(/^<span[^>]*role="img"[^>]*aria-label="Bank Statement"/);
    const blank = renderToString(<DocumentPicture type="BANK_STATEMENT" label="   " />);
    expect(blank).toContain('aria-hidden="true"');
  });

  it("falls back to today's icon for a type with no picture, an unknown word or nothing", () => {
    for (const type of ['COURT_ORDER', 'NOT_A_REAL_TYPE', '', null, undefined]) {
      const html = renderToString(<DocumentPicture type={type} />);
      expect(html, String(type)).toContain('data-picture="icon"');
      expect(html, String(type)).toContain('class="pic pic-fallback"');
      expect(html, String(type)).toContain('class="icon"');
      expect(html, String(type)).toContain('data-mark="file"');
    }
  });

  it('draws the generic paper instead of the icon only when asked', () => {
    const html = renderToString(<DocumentPicture type="COURT_ORDER" generic="picture" />);
    expect(html).toContain('data-picture="file"');
    expect(html).not.toContain('pic-fallback');
  });

  it('adds depth and placement classes only when asked', () => {
    expect(renderToString(<DocumentPicture type="VISA" />)).not.toContain('pic-depth');
    const html = renderToString(<DocumentPicture type="VISA" depth className="pic-float hero" />);
    expect(html).toContain('class="pic pic-document pic-depth pic-float hero"');
  });

  it('never points at a data: or blob: picture, for any catalogue type', () => {
    for (const document of CATALOGUE_DOCUMENTS) {
      for (const generic of ['icon', 'picture'] as const) {
        const html = renderToString(<DocumentPicture type={document.key} generic={generic} />);
        for (const value of references(html)) expect(value).not.toMatch(/^\s*(?:data|blob):/i);
        expect(html).not.toMatch(/(?:data|blob):/i);
      }
    }
  });

  it('has no accessibility problems, named or beside its word', async () => {
    const html = `<h1>Papers</h1><p>${renderToString(
      <DocumentPicture type="PASSPORT" label="Passport" />,
    )}</p><p>${renderToString(<DocumentPicture type="COURT_ORDER" />)} Court Order</p>`;
    expect(await axeViolations(html)).toEqual([]);
  });
});

describe('PassportCover', () => {
  it('shows the real cover, with its size and plain name, for a Bangladeshi traveller', () => {
    for (const nationality of ['Bangladeshi', 'BD', ' bgd ', 'Bangladesh']) {
      const html = renderToString(<PassportCover nationality={nationality} width={160} />);
      expect(html, nationality).toContain(`src="${BANGLADESH_COVER_SRC}"`);
      expect(html).toContain('width="160"');
      expect(html).toContain(`height="${passportCoverHeight(160)}"`);
      expect(passportCoverHeight(160)).toBe(228);
      expect(html).toContain(`alt="${COVER_LABELS.bangladesh}"`);
      expect(COVER_LABELS.bangladesh).toBe('Bangladesh Passport Cover');
    }
  });

  it('shows the neutral drawn cover for everyone else, and for no nationality', () => {
    for (const nationality of ['Indian', 'GB', '', null, undefined]) {
      const html = renderToString(<PassportCover nationality={nationality} width={120} />);
      expect(html, String(nationality)).not.toContain('<img');
      expect(html).toContain('data-picture="passport-neutral"');
      expect(html).toContain(`aria-label="${COVER_LABELS.neutral}"`);
      expect(html).toContain('width="120"');
      expect(html).toContain(`height="${passportCoverHeight(120)}"`);
    }
  });

  it('is hidden as decoration when the word sits beside it', () => {
    const real = renderToString(<PassportCover nationality="BD" decorative />);
    expect(real).toContain('alt=""');
    const neutral = renderToString(<PassportCover nationality="IN" decorative />);
    expect(neutral).toContain('aria-hidden="true"');
    expect(neutral).not.toContain('aria-label');
  });

  it('takes a screen-provided name', () => {
    const html = renderToString(<PassportCover nationality="BD" label="Your Passport" />);
    expect(html).toContain('alt="Your Passport"');
  });

  it('swaps to the neutral cover when the cover file cannot be shown', () => {
    act(() => {
      root = createRoot(container);
      root.render(<PassportCover nationality="Bangladeshi" />);
    });
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe(BANGLADESH_COVER_SRC);
    act(() => {
      image?.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-picture="passport-neutral"]')).not.toBeNull();
    expect(
      container.querySelector('[data-picture="passport-neutral"]')?.getAttribute('aria-label'),
    ).toBe(COVER_LABELS.neutral);
  });

  it('hydrates the server markup without a mismatch and keeps the real cover', () => {
    const html = renderToString(<PassportCover nationality="BD" />);
    container.innerHTML = html;
    const errors: unknown[] = [];
    act(() => {
      root = hydrateRoot(container, <PassportCover nationality="BD" />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(BANGLADESH_COVER_SRC);
  });

  it('never points at a data: or blob: picture', () => {
    for (const nationality of ['BD', 'IN']) {
      const html = renderToString(<PassportCover nationality={nationality} depth />);
      for (const value of references(html)) expect(value).not.toMatch(/^\s*(?:data|blob):/i);
    }
    const neutral = renderToString(<NeutralPassportCover />);
    expect(references(neutral)).toEqual([]);
  });

  it('has no accessibility problems', async () => {
    const html = `<h1>Passport</h1>${renderToString(
      <PassportCover nationality="BD" />,
    )}${renderToString(<PassportCover nationality="IN" />)}`;
    expect(await axeViolations(html)).toEqual([]);
  });
});

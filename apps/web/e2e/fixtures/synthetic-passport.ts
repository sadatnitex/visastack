import type { Browser } from '@playwright/test';

/**
 * A made-up passport page for the signed-in journeys, drawn at test time. No file is committed and
 * no real person is in it: the data is the specimen printed in ICAO Doc 9303 part 4 (Utopia, a
 * country that does not exist), and the page carries a SPECIMEN header so nobody can mistake it
 * for a real document. The two lines at the bottom are a real machine-readable zone with correct
 * check digits, so the product's reading has something true to read.
 */

export interface SpecimenFields {
  readonly surname: string;
  readonly given: string;
  readonly issuingState: string;
  readonly nationality: string;
  readonly documentNumber: string;
  readonly birthDate: string; // YYMMDD
  readonly sex: 'F' | 'M';
  readonly expiryDate: string; // YYMMDD
  readonly personalNumber: string;
}

/** The ICAO Doc 9303 specimen holder. */
export const SPECIMEN: SpecimenFields = {
  surname: 'ERIKSSON',
  given: 'ANNA MARIA',
  issuingState: 'UTO',
  nationality: 'UTO',
  documentNumber: 'L898902C3',
  birthDate: '740812',
  sex: 'F',
  expiryDate: '120415',
  personalNumber: 'ZE184226B',
};

/** The two lines exactly as ICAO prints them, to prove the generator against. */
export const ICAO_SPECIMEN_LINES = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
] as const;

const WEIGHTS = [7, 3, 1] as const;

function charValue(char: string): number {
  if (char === '<') return 0;
  if (/[0-9]/.test(char)) return Number(char);
  if (/[A-Z]/.test(char)) return char.charCodeAt(0) - 55;
  throw new Error(`Not a machine-readable character: ${char}`);
}

/** The ICAO check digit (weights 7, 3, 1 repeating) of a field. */
export function mrzCheckDigit(field: string): string {
  let sum = 0;
  for (let i = 0; i < field.length; i += 1) {
    sum += charValue(field[i] ?? '<') * (WEIGHTS[i % 3] ?? 1);
  }
  return String(sum % 10);
}

function pad(text: string, length: number): string {
  if (text.length > length) throw new Error(`"${text}" does not fit in ${length} characters`);
  return text + '<'.repeat(length - text.length);
}

/** The two 44-character lines of a TD3 (passport) machine-readable zone. */
export function buildTd3Lines(fields: SpecimenFields): readonly [string, string] {
  const name = `${fields.surname}<<${fields.given.replace(/ /g, '<')}`;
  const line1 = `P<${fields.issuingState}${pad(name, 39)}`;
  const number = pad(fields.documentNumber, 9);
  const personal = pad(fields.personalNumber, 14);
  const body = [
    number,
    mrzCheckDigit(number),
    fields.nationality,
    fields.birthDate,
    mrzCheckDigit(fields.birthDate),
    fields.sex,
    fields.expiryDate,
    mrzCheckDigit(fields.expiryDate),
    personal,
    mrzCheckDigit(personal),
  ].join('');
  const composite = mrzCheckDigit(body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43));
  return [line1, body + composite];
}

export type ScanVariant = 'first-scan' | 'clearer-scan';

export interface SyntheticFile {
  readonly name: string;
  readonly mimeType: 'image/png';
  readonly buffer: Buffer;
}

/** The page as HTML. The header says SPECIMEN in words, so a person or a reader sees it at once. */
export function specimenPassportHtml(variant: ScanVariant): string {
  const [line1, line2] = buildTd3Lines(SPECIMEN);
  // The first scan is a little soft, as a phone photo can be; the clearer one is sharp.
  const soften = variant === 'first-scan' ? 'filter: blur(0.6px) contrast(0.92);' : '';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><body style="margin:0;background:#fff;">
<div style="width:640px;height:440px;box-sizing:border-box;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111;border:2px solid #111;${soften}">
<div style="background:#111;color:#fff;padding:8px 12px;font-weight:700;letter-spacing:2px;">SPECIMEN - NOT A REAL DOCUMENT - TEST DATA ONLY</div>
<p style="margin:16px 0 4px;font-size:13px;">Passport / Type P / Issuing state ${SPECIMEN.issuingState} (Utopia)</p>
<p style="margin:4px 0;font-size:15px;"><b>Surname:</b> ${SPECIMEN.surname}</p>
<p style="margin:4px 0;font-size:15px;"><b>Given names:</b> ${SPECIMEN.given}</p>
<p style="margin:4px 0;font-size:15px;"><b>Document number:</b> ${SPECIMEN.documentNumber}</p>
<p style="margin:4px 0;font-size:15px;"><b>Date of birth:</b> 12 AUG 1974 &nbsp; <b>Sex:</b> ${SPECIMEN.sex}</p>
<p style="margin:4px 0;font-size:15px;"><b>Date of expiry:</b> 15 APR 2012</p>
<pre style="position:absolute;left:24px;bottom:44px;margin:0;font:700 17px 'Courier New',monospace;letter-spacing:1px;">${line1}\n${line2}</pre>
</div></body></html>`;
}

/**
 * Draws the specimen page to a PNG. Each call uses its own browser context so the picture is the
 * same wherever it runs, and the scale is the only thing that differs between the two scans, so
 * the clearer scan is a different file (different bytes) of the same document.
 */
export async function renderSyntheticPassport(
  browser: Browser,
  variant: ScanVariant,
): Promise<SyntheticFile> {
  const context = await browser.newContext({
    viewport: { width: 640, height: 440 },
    deviceScaleFactor: variant === 'clearer-scan' ? 2 : 1,
    colorScheme: 'light',
  });
  try {
    const page = await context.newPage();
    await page.setContent(specimenPassportHtml(variant));
    const buffer = await page.screenshot({ type: 'png' });
    return { name: `specimen-passport-${variant}.png`, mimeType: 'image/png', buffer };
  } finally {
    await context.close();
  }
}

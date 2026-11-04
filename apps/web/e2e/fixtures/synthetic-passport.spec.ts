import { expect, test } from '@playwright/test';
import {
  ICAO_SPECIMEN_LINES,
  SPECIMEN,
  buildTd3Lines,
  mrzCheckDigit,
  renderSyntheticPassport,
  specimenPassportHtml,
} from './synthetic-passport';

/**
 * The made-up passport the signed-in journeys upload is only safe and useful if it is built right:
 * a machine-readable zone with true check digits, a SPECIMEN header, and nobody real in it.
 */

test.describe('synthetic passport', () => {
  test('the generator reproduces the ICAO specimen lines exactly', () => {
    expect(buildTd3Lines(SPECIMEN)).toEqual([...ICAO_SPECIMEN_LINES]);
    for (const line of ICAO_SPECIMEN_LINES) expect(line).toHaveLength(44);
  });

  test('check digits follow the 7-3-1 rule', () => {
    // The worked examples printed in ICAO Doc 9303 part 3.
    expect(mrzCheckDigit('520727')).toBe('3');
    expect(mrzCheckDigit('L898902C3')).toBe('6');
    expect(mrzCheckDigit('740812')).toBe('2');
    expect(mrzCheckDigit('120415')).toBe('9');
  });

  test('a changed field changes its check digit, so a typo cannot pass as the specimen', () => {
    const changed = buildTd3Lines({ ...SPECIMEN, documentNumber: 'L898902C4' });
    expect(changed[1]).not.toBe(ICAO_SPECIMEN_LINES[1]);
    expect(changed[1]?.slice(9, 10)).not.toBe('6');
  });

  test('the page says SPECIMEN and holds only the specimen holder', () => {
    const html = specimenPassportHtml('clearer-scan');
    expect(html).toContain('SPECIMEN - NOT A REAL DOCUMENT - TEST DATA ONLY');
    expect(html).toContain('ERIKSSON');
    expect(html).toContain('Utopia');
    // No email address, phone number or street in the page.
    expect(html).not.toMatch(/@|\+\d{6,}|\b\d+ [A-Z][a-z]+ (Street|Road|Avenue)\b/);
  });

  test('two scans of the same page are different files, drawn without committing a binary', async ({
    browser,
  }) => {
    const first = await renderSyntheticPassport(browser, 'first-scan');
    const clearer = await renderSyntheticPassport(browser, 'clearer-scan');
    for (const file of [first, clearer]) {
      expect(file.mimeType).toBe('image/png');
      expect(file.buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(file.buffer.length).toBeGreaterThan(1_000);
    }
    expect(first.name).not.toBe(clearer.name);
    expect(first.buffer.equals(clearer.buffer)).toBe(false);
    // The clearer scan has twice the pixels in each direction.
    expect(clearer.buffer.readUInt32BE(16)).toBe(first.buffer.readUInt32BE(16) * 2);
  });
});

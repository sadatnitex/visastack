import {
  AI_CONNECTION_DEFAULT_DURATION as SERVICE_DEFAULT_DURATION,
  AI_CONNECTION_DEFAULT_LAYERS as SERVICE_DEFAULT_LAYERS,
  AI_CONNECTION_DURATIONS as SERVICE_DURATIONS,
  AI_FILE_CHOICES_MAX as SERVICE_FILE_CHOICES_MAX,
  AI_FILE_DEFAULT_VARIANT as SERVICE_FILE_DEFAULT_VARIANT,
  AI_FILE_VARIANTS as SERVICE_FILE_VARIANTS,
  AI_CONNECTION_LAYERS as SERVICE_LAYERS,
  AI_SUGGEST_CHANGES_SCOPE as SERVICE_SUGGEST_CHANGES_SCOPE,
  AI_CONNECTION_WARNING_LAYERS as SERVICE_WARNING_LAYERS,
  scopesFromChoices,
} from '@visastack/services';
import { describe, expect, it } from 'vitest';
import * as browser from './ai-consent-choices';
import {
  AI_DOCUMENT_LIST_LABEL,
  AI_DOCUMENT_TEXT_LABEL,
  AI_DURATION_LABELS,
  AI_FULL_NUMBERS_LABEL,
  AI_LAYER_LABELS,
  AI_LAYER_NOTES,
  aiAccessLabels,
} from './ai-consent-labels';

describe('the consent screen vocabulary', () => {
  it('is the same list the server stores and checks', () => {
    expect(browser.AI_CONNECTION_LAYERS).toEqual(SERVICE_LAYERS);
    expect(browser.AI_CONNECTION_DEFAULT_LAYERS).toEqual(SERVICE_DEFAULT_LAYERS);
    expect(browser.AI_CONNECTION_WARNING_LAYERS).toEqual(SERVICE_WARNING_LAYERS);
    expect(browser.AI_CONNECTION_DURATIONS).toEqual(SERVICE_DURATIONS);
    expect(browser.AI_CONNECTION_DEFAULT_DURATION).toBe(SERVICE_DEFAULT_DURATION);
    expect(browser.AI_SUGGEST_CHANGES_SCOPE).toBe(SERVICE_SUGGEST_CHANGES_SCOPE);
    expect(
      scopesFromChoices({
        layers: [],
        documentList: false,
        documentText: false,
        suggestChanges: true,
      }),
    ).toEqual([browser.AI_SUGGEST_CHANGES_SCOPE]);
  });

  it('names every choice, in words without engineering terms', () => {
    for (const layer of browser.AI_CONNECTION_LAYERS) {
      expect(AI_LAYER_LABELS[layer]).toBeTruthy();
      expect(AI_LAYER_NOTES[layer]).toBeTruthy();
    }
    for (const duration of browser.AI_CONNECTION_DURATIONS) {
      expect(AI_DURATION_LABELS[duration]).toBeTruthy();
    }
    const words = JSON.stringify([
      AI_LAYER_LABELS,
      AI_LAYER_NOTES,
      AI_DURATION_LABELS,
      AI_DOCUMENT_LIST_LABEL,
      AI_DOCUMENT_TEXT_LABEL,
      AI_FULL_NUMBERS_LABEL,
    ]).toLowerCase();
    for (const banned of ['oauth', 'mcp', 'token', 'scope']) expect(words).not.toContain(banned);
  });
});

describe('choices kept through a fresh sign-in check', () => {
  it('come back exactly as chosen', () => {
    const chosen: browser.ConsentInitial = {
      layers: ['identity', 'health'],
      cases: 'none',
      documentList: false,
      documentText: true,
      revealIdentifiers: true,
      suggestChanges: true,
      duration: '1h',
    };
    const query = browser.consentChoicesToQuery(chosen);
    // Every read choice comes back, but never a ticked Suggest Changes: a link cannot carry it (S21).
    expect(browser.consentChoicesFromQuery((name) => query[name])).toEqual({
      ...chosen,
      suggestChanges: false,
    });
  });

  it('fall back to the safe defaults for anything unknown', () => {
    expect(browser.consentChoicesFromQuery(() => undefined)).toEqual(browser.CONSENT_DEFAULTS);
    const odd = browser.consentChoicesFromQuery(
      (name) =>
        ({
          choice_layers: 'identity,everything',
          choice_cases: '<script>',
          choice_duration: 'forever',
        })[name],
    );
    expect(odd).toMatchObject({ layers: ['identity'], cases: 'all', duration: '30d' });
  });
});

describe('the case the consent screen starts with (ADR 0021 section 5)', () => {
  const CASE = '11111111-1111-4111-8111-111111111111';
  it('is the case the person came from, or else all current cases', () => {
    expect(browser.settleConsentCases(browser.CONSENT_DEFAULTS, [CASE], CASE).cases).toBe(CASE);
    expect(browser.settleConsentCases(browser.CONSENT_DEFAULTS, [CASE]).cases).toBe('all');
  });
  it('never preselects a case that is not on the screen, and keeps the person own choice', () => {
    const stale = { ...browser.CONSENT_DEFAULTS, cases: CASE };
    expect(browser.settleConsentCases(stale, []).cases).toBe('all');
    expect(browser.settleConsentCases(browser.CONSENT_DEFAULTS, [], CASE).cases).toBe('all');
    const chosen = { ...browser.CONSENT_DEFAULTS, cases: 'none' };
    expect(browser.settleConsentCases(chosen, [CASE], CASE)).toBe(chosen);
  });
});

describe('what a stored connection can read, in the consent words', () => {
  it('lists the chosen parts in the consent order and ignores anything unknown', () => {
    expect(aiAccessLabels(['document_text', 'money', 'identity', 'document_list', 'odd'])).toEqual([
      'Personal Details',
      'Money',
      'List of My Documents',
      'Text Read From My Documents',
    ]);
    expect(aiAccessLabels([])).toEqual([]);
  });
  it('knows the Change Access durations', () => {
    expect(browser.isAiChangeDuration('keep')).toBe(true);
    expect(browser.isAiChangeDuration('7d')).toBe(true);
    expect(browser.isAiChangeDuration('forever')).toBe(false);
    expect(browser.isAiChangeDuration(undefined)).toBe(false);
  });
});

describe('reading the submitted choices (one parser for consent and Change Access)', () => {
  const CASE = '11111111-1111-4111-8111-111111111111';
  const form = (fields: Record<string, string | string[]>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
    }
    return data;
  };

  it('reads the choices in the stored vocabulary and drops anything unknown', () => {
    const parsed = browser.parseAiAccessChoices(
      form({
        layer: ['money', 'identity', 'everything'],
        cases: CASE,
        document_list: 'on',
        reveal_identifiers: 'on',
        duration: '7d',
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        layers: ['identity', 'money'],
        cases: CASE,
        caseMode: 'ONE',
        missionId: CASE,
        documentList: true,
        documentText: false,
        revealIdentifiers: true,
        suggestChanges: false,
        duration: '7d',
      },
    });
    // "Suggest Changes" only when its box is ticked (S21).
    const ticked = browser.parseAiAccessChoices(form({ suggest_changes: 'on' }));
    expect(ticked.ok && ticked.value.suggestChanges).toBe(true);
    const other = browser.parseAiAccessChoices(form({ suggest_changes: 'yes' }));
    expect(other.ok && other.value.suggestChanges).toBe(false);
  });

  it('defaults to all current cases and the screen default for How Long', () => {
    const consent = browser.parseAiAccessChoices(form({}));
    expect(consent.ok && consent.value).toMatchObject({
      caseMode: 'ALL_CURRENT',
      cases: 'all',
      duration: '30d',
    });
    const change = browser.parseAiAccessChoices(form({ cases: 'none' }), { allowKeep: true });
    expect(change.ok && change.value).toMatchObject({ caseMode: 'NONE', duration: 'keep' });
  });

  it('names the field at fault, and offers "keep" only on Change Access', () => {
    expect(browser.parseAiAccessChoices(form({ cases: '<script>' }))).toMatchObject({
      ok: false,
      field: 'cases',
    });
    expect(browser.parseAiAccessChoices(form({ duration: 'forever' }))).toMatchObject({
      ok: false,
      field: 'duration',
    });
    expect(browser.parseAiAccessChoices(form({ duration: 'keep' }))).toMatchObject({
      ok: false,
      field: 'duration',
    });
    expect(browser.parseAiAccessChoices(form({ duration: 'keep' }), { allowKeep: true }).ok).toBe(
      true,
    );
  });
});

describe('Original Files choices (S20)', () => {
  const A = '44444444-4444-4444-8444-444444444444';
  const B = '55555555-5555-4555-8555-555555555555';
  const form = (fields: Record<string, string | string[]>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
    }
    return data;
  };

  it('uses the same ways, default and limit as the server', () => {
    expect(browser.AI_FILE_VARIANTS).toEqual(SERVICE_FILE_VARIANTS);
    expect(browser.AI_FILE_DEFAULT_VARIANT).toBe(SERVICE_FILE_DEFAULT_VARIANT);
    expect(browser.AI_FILE_DEFAULT_VARIANT).toBe('SAFE_COPY');
    expect(browser.AI_FILE_CHOICES_MAX).toBe(SERVICE_FILE_CHOICES_MAX);
  });

  it('reads a Safe Copy unless the Original was chosen, each document once, ids only', () => {
    expect(
      browser.parseAiFileChoices(
        form({
          files_present: '1',
          file: [A, B, A.toUpperCase(), 'nope'],
          [`file_variant_${B}`]: 'ORIGINAL',
          [`file_variant_${A}`]: 'ANYTHING',
        }),
      ),
    ).toEqual([
      { documentId: A, variant: 'SAFE_COPY' },
      { documentId: B, variant: 'ORIGINAL' },
    ]);
    // No choices shown: nothing read, so what is stored is kept.
    expect(browser.parseAiFileChoices(form({ file: [A] }))).toBeUndefined();
    expect(browser.parseAiFileChoices(form({ files_present: '1' }))).toEqual([]);
  });

  it('needs List of My Documents for any file, and refuses more than the limit', () => {
    const base = { layer: 'identity', cases: 'all', duration: '30d', files_present: '1' };
    expect(browser.parseAiAccessChoices(form({ ...base, file: [A] }))).toMatchObject({
      ok: false,
      field: 'document_list',
    });
    const many = Array.from(
      { length: browser.AI_FILE_CHOICES_MAX + 1 },
      (_, index) => `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    );
    expect(
      browser.parseAiAccessChoices(form({ ...base, document_list: 'on', file: many })),
    ).toMatchObject({ ok: false, field: 'file' });
    const parsed = browser.parseAiAccessChoices(form({ ...base, document_list: 'on', file: [A] }));
    expect(parsed.ok && parsed.value.files).toEqual([{ documentId: A, variant: 'SAFE_COPY' }]);
  });

  it('keeps what was typed after a refusal, never more than the form could show', () => {
    const kept = browser.keptAiChoices(
      form({ layer: ['money', 'bogus'], cases: 'none', files_present: '1', file: [A] }),
    );
    expect(kept).toMatchObject({
      layers: ['money'],
      cases: 'none',
      documentList: false,
      files: [{ documentId: A, variant: 'SAFE_COPY' }],
    });
  });

  it('without scripts: reads the Original of a ticked box, and ignores a choice for an unticked one', () => {
    expect(
      browser.parseAiFileChoices(
        form({
          files_present: '1',
          file: [A],
          [`file_variant_${A}`]: 'ORIGINAL',
          [`file_variant_${B}`]: 'ORIGINAL',
        }),
      ),
    ).toEqual([{ documentId: A, variant: 'ORIGINAL' }]);
  });
});

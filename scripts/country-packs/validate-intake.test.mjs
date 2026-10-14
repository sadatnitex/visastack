import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SHEET_COLUMNS,
  liveChecks,
  numbersIn,
  pageText,
  parseCsv,
  quoteStatus,
  validateIntake,
} from './validate-intake.mjs';

const source = {
  source_url: 'https://www.gov.example.gov.uk/visa/bangladesh',
  source_title: 'Visa',
  publisher: 'Home Office',
  source_type: 'government',
  source_language: 'English',
  retrieved_on: '2026-10-01',
  exact_words_copied: 'Bangladesh nationals need a visa. The fee is 100.',
  english_translation_if_not_english: '',
  where_in_source: 'Overview',
  confidence: 'HIGH',
  needs_human_check: 'NO',
  notes: '',
};
const base = {
  countries: {
    country: 'Examplestan',
    iso2: 'EX',
    entry_status_for_bangladesh_ordinary_passport: 'VISA_REQUIRED',
    maximum_stay_days: 'NOT_FOUND',
    stay_period_rule: 'NOT_FOUND',
    passport_validity_rule: 'NOT_FOUND',
    how_to_apply: 'EMBASSY',
    official_apply_url: 'https://apply.example.gov.uk/',
    bangladesh_location_for_biometrics_or_submission: 'Dhaka',
    official_fee_amount: '100',
    official_fee_currency: 'USD',
    visa_routes_the_official_site_lists: 'visit',
    ...source,
  },
  routes: {
    pack_key: 'ex.visitor',
    country_or_area: 'Examplestan',
    issuing_country_if_schengen_or_gulf: '',
    visa_official_name: 'Visitor visa',
    visa_code_or_subclass: 'V',
    purpose: 'visit',
    plain_description_2_to_3_sentences: 'Visit.',
    applies_to_nationality: 'Bangladesh',
    applies_when_applying_from: 'Bangladesh',
    rules_take_effect_on: 'NOT_FOUND',
    official_fee_amount: '100',
    official_fee_currency: 'USD',
    official_application_channel_name: 'Embassy',
    official_application_channel_url: 'https://apply.example.gov.uk/',
    official_fraud_reporting_url: '',
    ...source,
  },
  requirements: {
    pack_key: 'ex.visitor',
    kind: 'DOCUMENT',
    what_is_required: 'A passport',
    required_or_optional: 'required',
    only_when: '',
    must_be_dated_within_days: '',
    ...source,
    exact_words_copied: 'You must provide a valid passport.',
  },
};
const sheet = (name, rows) => [
  SHEET_COLUMNS[name],
  ...rows.map((r) => SHEET_COLUMNS[name].map((c) => r[c] ?? '')),
];
const run = (over = {}) => {
  const rows = {
    countries: [base.countries],
    routes: [base.routes],
    requirements: Array.from({ length: 5 }, (_, i) => ({
      ...base.requirements,
      what_is_required: `Item ${'ABCDE'[i]}`,
    })),
    ...over,
  };
  return validateIntake({
    countries: sheet('countries', rows.countries),
    routes: sheet('routes', rows.routes),
    requirements: sheet('requirements', rows.requirements),
  });
};
const codes = (r) => r.findings.map((f) => `${f.sheet}:${f.code}`);
const five = (extra) =>
  Array.from({ length: 5 }, (_, i) => ({
    ...base.requirements,
    what_is_required: `Item ${'ABCDE'[i]}`,
    ...(i === 0 ? extra : {}),
  }));

test('reads quotes, commas, line breaks and doubled quotes', () => {
  const rows = parseCsv('a,"b,c","d\ne","f ""g"""\r\n1,2,3,4\n');
  assert.deepEqual(rows, [
    ['a', 'b,c', 'd\ne', 'f "g"'],
    ['1', '2', '3', '4'],
  ]);
});

test('a clean, complete set has no errors or warnings', () => {
  const r = run();
  assert.deepEqual(codes(r), []);
});

test('missing words, bad lists, bad addresses and future dates are errors', () => {
  const bad = {
    ...base.countries,
    exact_words_copied: '',
    how_to_apply: '',
    source_url: 'http://x.example.gov/a',
    retrieved_on: '2999-01-01',
  };
  const r = run({ countries: [bad] });
  for (const c of ['NO_QUOTE', 'BAD_ENUM', 'BAD_URL', 'FUTURE_DATE'])
    assert.ok(codes(r).includes(`countries:${c}`), c);
});

test('a country or code that appears twice is an error', () => {
  const r = run({ countries: [base.countries, base.countries] });
  assert.ok(codes(r).includes('countries:DUPLICATE'));
});

test('values with no proof in the copied words are flagged, including a free fee', () => {
  const r = run({
    countries: [{ ...base.countries, official_fee_amount: '250', maximum_stay_days: '30' }],
  });
  assert.ok(codes(r).includes('countries:VALUE_NOT_IN_QUOTE'));
  const zero = run({
    countries: [{ ...base.countries, official_fee_amount: '0' }],
    routes: [{ ...base.routes, official_fee_amount: '0' }],
  });
  assert.ok(codes(zero).includes('countries:ZERO_UNPROVEN'));
  assert.ok(codes(zero).includes('routes:ZERO_UNPROVEN'));
  const fee = run({ routes: [{ ...base.routes, official_fee_amount: '341' }] });
  assert.ok(codes(fee).includes('routes:FEE_NOT_IN_QUOTE'));
});

test('words that never mention Bangladesh cannot prove the status for Bangladeshis', () => {
  const r = run({
    countries: [
      {
        ...base.countries,
        source_url: 'https://www.example.gov.uk/visa',
        exact_words_copied: 'Visitors need a visa.',
        official_fee_amount: 'NOT_FOUND',
        official_fee_currency: 'NOT_FOUND',
      },
    ],
  });
  assert.ok(codes(r).includes('countries:NOT_ABOUT_BANGLADESH'));
});

test('a contradiction between the status and how to apply is flagged', () => {
  const r = run({
    countries: [
      {
        ...base.countries,
        entry_status_for_bangladesh_ordinary_passport: 'E_VISA',
        how_to_apply: 'EMBASSY',
      },
    ],
  });
  assert.ok(codes(r).includes('countries:CONTRADICTION'));
});

test('the same six routes everywhere is flagged as a template, not proof', () => {
  const r = run({
    countries: [
      {
        ...base.countries,
        visa_routes_the_official_site_lists: 'visit, study, work, family, transit, business',
      },
    ],
  });
  assert.ok(codes(r).includes('countries:ROUTE_LIST_TEMPLATE'));
});

test('a site that does not look official is flagged for a person to confirm', () => {
  const r = run({
    routes: [{ ...base.routes, source_url: 'https://travelblog.example.com/visa' }],
  });
  assert.ok(codes(r).includes('routes:HOST_NOT_RECOGNISED'));
});

test('a step to do is not a detail', () => {
  const r = run({ requirements: five({ kind: 'DETAIL', what_is_required: 'Pay the visa fee' }) });
  assert.ok(codes(r).includes('requirements:PROCESS_STEP'));
  const ok = run({
    requirements: five({ kind: 'PROCESS_STEP', what_is_required: 'Pay the visa fee' }),
  });
  assert.ok(!codes(ok).includes('requirements:PROCESS_STEP'));
});

test('a covered period is not an age limit, but a real age limit passes', () => {
  const coverage = run({
    requirements: five({
      must_be_dated_within_days: '180',
      what_is_required: 'Bank statements',
      exact_words_copied: 'Bank statement for the last six months',
    }),
  });
  assert.ok(codes(coverage).includes('requirements:COVERAGE_NOT_AGE'));
  const real = run({
    requirements: five({
      must_be_dated_within_days: '90',
      what_is_required: 'Photo',
      exact_words_copied: 'A photograph taken within the last three months',
    }),
  });
  assert.ok(!codes(real).some((c) => c.endsWith('COVERAGE_NOT_AGE') || c.endsWith('NO_AGE_WORDS')));
  const detail = run({ requirements: five({ kind: 'DETAIL', must_be_dated_within_days: '4' }) });
  assert.ok(codes(detail).includes('requirements:AGE_ON_NON_DOCUMENT'));
});

test('a number in the requirement must appear in the copied words', () => {
  const r = run({
    requirements: five({
      what_is_required: 'Passport valid for 6 months',
      exact_words_copied: 'A valid passport',
    }),
  });
  assert.ok(codes(r).includes('requirements:NUMBER_NOT_IN_QUOTE'));
  const words = run({
    requirements: five({
      what_is_required: 'Passport valid for 6 months',
      exact_words_copied: 'Valid for six months',
    }),
  });
  assert.ok(!codes(words).includes('requirements:NUMBER_NOT_IN_QUOTE'));
});

test('routes need requirements, and thin routes are warned about', () => {
  const unknown = run({ requirements: [{ ...base.requirements, pack_key: 'zz.other' }] });
  assert.ok(codes(unknown).includes('requirements:UNKNOWN_ROUTE'));
  assert.ok(codes(unknown).includes('routes:NO_REQUIREMENTS'));
  const thin = run({ requirements: [base.requirements] });
  assert.ok(codes(thin).includes('routes:THIN_ROUTE'));
});

test('numbers are read the way people write them', () => {
  assert.deepEqual(
    [...numbersIn('BDT 22,450 and six months, 3.50')].sort(),
    ['22450', '3.50', '6'].sort(),
  );
});

test('copied words are found despite case, spacing and curly quotes', () => {
  const page = pageText(
    '<html><body><script>x()</script><p>You   must provide a <b>valid</b> passport &amp; “other” travel document.</p></body></html>',
  );
  assert.equal(
    quoteStatus(page, 'you must provide a valid passport & "other" travel document'),
    'FOUND',
  );
  assert.equal(
    quoteStatus(page, 'You must provide a valid passport and a letter from the bank of the king'),
    'MISSING',
  );
  const longPage = pageText('<p>a b c d e f g h i j k l m n o p</p>');
  assert.equal(quoteStatus(longPage, 'a b c d e f g h i j k l m n o X'), 'PARTIAL');
});

test('the live check finds, misses, and reports pages it cannot open; PDFs are skipped', async () => {
  const pages = {
    'https://a.gov.example/ok': '<p>You must provide a valid passport.</p>',
    'https://a.gov.example/other': '<p>Nothing relevant here at all.</p>',
  };
  const fetchPage = async (url) =>
    pages[url] ? { ok: true, status: 200, body: pages[url] } : { ok: false, status: 404, body: '' };
  const rows = [
    {
      __row: 2,
      source_url: 'https://a.gov.example/ok',
      exact_words_copied: 'You must provide a valid passport.',
    },
    {
      __row: 3,
      source_url: 'https://a.gov.example/other',
      exact_words_copied: 'You must provide a valid passport.',
    },
    { __row: 4, source_url: 'https://a.gov.example/gone', exact_words_copied: 'x' },
    { __row: 5, source_url: 'https://a.gov.example/doc.pdf', exact_words_copied: 'x' },
  ];
  const found = [];
  await liveChecks({ requirements: rows }, fetchPage, (_sheet, row, _field, severity, code) =>
    found.push(`${row}:${severity}:${code}`),
  );
  assert.deepEqual(found.sort(), ['3:ERROR:QUOTE_NOT_ON_PAGE', '4:WARN:PAGE_UNREACHABLE']);
});

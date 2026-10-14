// Turns the three country sheets into one data file the app reads (packages/core/src/destinations).
// The sheets are used as given: every record keeps its source link and the date it was checked.
// Usage: node scripts/country-packs/build-destinations.mjs [batchFolder] [outFile]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCsv } from './validate-intake.mjs';

const clean = (v) => {
  const t = String(v ?? '').trim();
  return t === '' || t === 'NOT_FOUND' ? null : t;
};
const whole = (v) => (/^\d+$/.test(String(v ?? '').trim()) ? Number(v) : null);
const money = (amount, currency) => {
  const a = clean(amount);
  const c = clean(currency);
  if (a === null || c === null || Number.isNaN(Number(a.replace(/,/g, '')))) return null;
  return { amount: Number(a.replace(/,/g, '')), currency: c };
};

function rowsOf(text) {
  const [header, ...body] = parseCsv(text);
  const names = header.map((h) => h.split(' (')[0].trim());
  return body
    .filter((cells) => cells.some((c) => c.trim() !== ''))
    .map((cells) => Object.fromEntries(names.map((n, i) => [n, (cells[i] ?? '').trim()])));
}

function sourceOf(r) {
  const url = clean(r.source_url);
  if (url === null) return null;
  return {
    url,
    title: clean(r.source_title),
    publisher: clean(r.publisher),
    type: clean(r.source_type),
    language: clean(r.source_language),
    checkedOn: clean(r.retrieved_on),
    exactWords: clean(r.exact_words_copied),
    translation: clean(r.english_translation_if_not_english),
    where: clean(r.where_in_source),
    confidence: clean(r.confidence),
    needsCheck: r.needs_human_check === 'YES',
    note: clean(r.notes),
  };
}

export function buildDestinations({ countries, routes, requirements }) {
  const reqs = new Map();
  for (const r of rowsOf(requirements)) {
    const list = reqs.get(r.pack_key) ?? [];
    list.push({
      kind: r.kind,
      text: r.what_is_required,
      optional: r.required_or_optional === 'optional',
      onlyWhen: clean(r.only_when),
      maxAgeDays: whole(r.must_be_dated_within_days),
      source: sourceOf(r),
    });
    reqs.set(r.pack_key, list);
  }
  return {
    batch: 'batch-001',
    countries: rowsOf(countries).map((r) => ({
      country: r.country,
      iso2: r.iso2,
      researched: (r.entry_status_for_bangladesh_ordinary_passport || 'NOT_FOUND') !== 'NOT_FOUND',
      entryStatus: r.entry_status_for_bangladesh_ordinary_passport || 'NOT_FOUND',
      maximumStayDays: whole(r.maximum_stay_days),
      stayPeriodRule: clean(r.stay_period_rule),
      passportValidityRule: clean(r.passport_validity_rule),
      howToApply: clean(r.how_to_apply),
      applyUrl: clean(r.official_apply_url),
      bangladeshLocation: clean(r.bangladesh_location_for_biometrics_or_submission),
      fee: money(r.official_fee_amount, r.official_fee_currency),
      routeTypes: (clean(r.visa_routes_the_official_site_lists) ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      source: sourceOf(r),
    })),
    routes: rowsOf(routes).map((r) => ({
      key: r.pack_key,
      country: r.country_or_area,
      issuingNote: clean(r.issuing_country_if_schengen_or_gulf),
      name: r.visa_official_name,
      code: clean(r.visa_code_or_subclass),
      purpose: r.purpose,
      description: clean(r.plain_description_2_to_3_sentences),
      appliesTo: clean(r.applies_to_nationality),
      appliesFrom: clean(r.applies_when_applying_from),
      rulesTakeEffectOn: clean(r.rules_take_effect_on),
      fee: money(r.official_fee_amount, r.official_fee_currency),
      channelName: clean(r.official_application_channel_name),
      channelUrl: clean(r.official_application_channel_url),
      fraudReportingUrl: clean(r.official_fraud_reporting_url),
      source: sourceOf(r),
      requirements: reqs.get(r.pack_key) ?? [],
    })),
  };
}

export function readBatch(folder) {
  const read = (f) => readFileSync(join(folder, f), 'utf8');
  return {
    countries: read('0-countries.csv'),
    routes: read('1-routes.csv'),
    requirements: read('2-requirements.csv'),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const folder =
    process.argv[2] ?? 'docs/product/master-profile-enrichment/country-intake/batch-001';
  const out = process.argv[3] ?? 'packages/core/src/destinations/batch-001.json';
  writeFileSync(out, `${JSON.stringify(buildDestinations(readBatch(folder)), null, 2)}\n`);
}

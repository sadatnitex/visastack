// Checks the country visa sheets (countries, routes, requirements) before anything is loaded.
// Offline checks need no network. Live checks (--live) open each cited page and look for the copied words.
// Usage: node scripts/country-packs/validate-intake.mjs --countries a.csv --routes b.csv --requirements c.csv [--out report.csv] [--live]
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const SOURCE_COLUMNS = [
  'source_url',
  'source_title',
  'publisher',
  'source_type',
  'source_language',
  'retrieved_on',
  'exact_words_copied',
  'english_translation_if_not_english',
  'where_in_source',
  'confidence',
  'needs_human_check',
  'notes',
];
export const SHEET_COLUMNS = {
  countries: [
    'country',
    'iso2',
    'entry_status_for_bangladesh_ordinary_passport',
    'maximum_stay_days',
    'stay_period_rule',
    'passport_validity_rule',
    'how_to_apply',
    'official_apply_url',
    'bangladesh_location_for_biometrics_or_submission',
    'official_fee_amount',
    'official_fee_currency',
    'visa_routes_the_official_site_lists',
    ...SOURCE_COLUMNS,
  ],
  routes: [
    'pack_key',
    'country_or_area',
    'issuing_country_if_schengen_or_gulf',
    'visa_official_name',
    'visa_code_or_subclass',
    'purpose',
    'plain_description_2_to_3_sentences',
    'applies_to_nationality',
    'applies_when_applying_from',
    'rules_take_effect_on',
    'official_fee_amount',
    'official_fee_currency',
    'official_application_channel_name',
    'official_application_channel_url',
    'official_fraud_reporting_url',
    ...SOURCE_COLUMNS,
  ],
  requirements: [
    'pack_key',
    'kind',
    'what_is_required',
    'required_or_optional',
    'only_when',
    'must_be_dated_within_days',
    ...SOURCE_COLUMNS,
  ],
};

// Columns a sheet may carry without requiring them.
const OPTIONAL = { routes: ['requirements_complete', 'checklist_page_url'] };

const ENTRY_STATUS = [
  'VISA_FREE',
  'VISA_ON_ARRIVAL',
  'E_VISA',
  'ETA',
  'VISA_REQUIRED',
  'NOT_ADMITTED_OR_SUSPENDED',
  'NOT_FOUND',
];
const HOW_TO_APPLY = ['EMBASSY', 'APPLICATION_CENTRE', 'E_VISA_PORTAL', 'ON_ARRIVAL', 'NONE'];
const PURPOSES = ['visit', 'study', 'work', 'family', 'transit', 'business', 'other'];
const SOURCE_TYPES = ['government', 'embassy', 'visa application centre', 'other'];
const KINDS = ['DETAIL', 'DOCUMENT', 'PROCESS_STEP'];
const OFFICIAL_HOST =
  /(\.gov(\.[a-z]{2})?$|\.gob\.|\.govt\.|\.gouv\.|\.go\.[a-z]{2}$|^gov\.|\.gc\.ca$|\.europa\.eu$|\.mil$|(^|\.)mfa\.|\.mofa\.|immigration|migracao|migration|imigrasi|evisa|e-visa|\.admin\.ch$|embassy|emb-japan|embaixada|consulado|highcommission|\.gov$)/i;
const CENTRE_HOST =
  /(vfsglobal|tlscontact|blsinternational|blsspain|visaforchina|idata|gatewayy|cox-kings)/i;
const WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const PROCEDURE_WORDS =
  /\b(fee|payment|pay|biometric|fingerprint|interview|appointment|declaration|bond|receipt|submit|attend|online application)\b/i;
const HEDGES =
  /\b(generally|typically|usually|probably|may require|should verify|verify|likely|appears|assumed)\b/i;
const COVERAGE =
  /(\b(last|past|previous)\s+\w+\s*(\(\d+\))?\s*months?\b|\bfor a\s+\d+\s+months?\s+period\b|\b(three|\d+)\s+to\s+(twelve|\d+)\s+months\b|\b\d+\s+(days?|months?)\s+bank statements?\b|\bbank statements?\s+for\s+(the\s+)?(last|past)\b)/i;
const FRESHNESS =
  /(not\s+(older|more|less)\s+than|no\s+older\s+than|taken\s+within|dated\s+within|issued\s+within|within\s+(the\s+)?(last|past)\s+\w+\s*(\(\d+\))?\s*(days?|months?)|not\s+less\s+than\s+\w+\s+months?\s+old|should\s+not\s+be\s+older)/i;

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const isNotFound = (v) => String(v ?? '').trim() === 'NOT_FOUND';
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const norm = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Numbers in a text, as plain digits (22,450 -> 22450; "six" -> 6). */
export function numbersIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    out.add(m[0].replace(/,/g, '').replace(/\.0+$/, ''));
  }
  for (const m of norm(text).matchAll(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,
  )) {
    out.add(String(WORD_NUMBERS[m[1]]));
  }
  return out;
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function validateIntake(sheets) {
  const findings = [];
  const add = (sheet, rowNo, field, severity, code, message) =>
    findings.push({ sheet, row: rowNo, field, severity, code, message });
  const data = {};

  for (const [name, expected] of Object.entries(SHEET_COLUMNS)) {
    const raw = sheets[name];
    if (!raw) continue;
    const header = (raw[0] ?? []).map((h) => String(h).split(' (')[0].trim());
    const missing = expected.filter((h) => !header.includes(h));
    const extra = header.filter(
      (h) => !expected.includes(h) && !(OPTIONAL[name] ?? []).includes(h),
    );
    if (missing.length > 0)
      add(name, 1, '', 'ERROR', 'HEADER_MISSING', `missing columns: ${missing.join(', ')}`);
    if (extra.length > 0)
      add(name, 1, '', 'WARN', 'HEADER_EXTRA', `unknown columns: ${extra.join(', ')}`);
    data[name] = raw
      .slice(1)
      .map((cells, i) => ({ rowNo: i + 2, cells }))
      .filter(({ cells }) => cells.some((c) => String(c).trim() !== ''))
      .map(({ rowNo, cells }) => {
        const r = { __row: rowNo };
        header.forEach((h, idx) => {
          r[h] = String(cells[idx] ?? '').trim();
        });
        if (cells.length !== header.length) {
          add(
            name,
            rowNo,
            '',
            'ERROR',
            'COLUMN_COUNT',
            `row has ${cells.length} cells, header has ${header.length}`,
          );
        }
        return r;
      });
  }

  const today = new Date().toISOString().slice(0, 10);
  const hosts = new Map();

  function sourceChecks(sheet, r) {
    const at = (field, sev, code, msg) => add(sheet, r.__row, field, sev, code, msg);
    const url = r.source_url;
    if (isBlank(url) || isNotFound(url))
      at('source_url', 'ERROR', 'NO_SOURCE', 'every row needs the exact source page');
    else {
      const host = hostOf(url);
      if (!host || !/^https:\/\//i.test(url))
        at('source_url', 'ERROR', 'BAD_URL', 'source must be a full https address');
      else {
        hosts.set(host, (hosts.get(host) ?? 0) + 1);
        const path = new URL(url).pathname;
        if (path === '/' || path === '')
          at('source_url', 'WARN', 'HOME_PAGE', 'source is a home page, not the exact page');
        if (!OFFICIAL_HOST.test(host) && !CENTRE_HOST.test(host)) {
          at(
            'source_url',
            'WARN',
            'HOST_NOT_RECOGNISED',
            `${host} is not recognised as an official site; confirm who runs it`,
          );
        }
        if (CENTRE_HOST.test(host) && r.source_type === 'government') {
          at(
            'source_type',
            'WARN',
            'TYPE_MISMATCH',
            'this looks like an application centre but is labelled government',
          );
        }
        if (/\.pdf($|\?)/i.test(url))
          at('source_url', 'INFO', 'PDF_SOURCE', 'PDF source: the live page check cannot read it');
      }
    }
    if (!SOURCE_TYPES.includes(r.source_type))
      at(
        'source_type',
        'ERROR',
        'BAD_ENUM',
        `source_type must be one of ${SOURCE_TYPES.join(' / ')}`,
      );
    if (!isDate(r.retrieved_on))
      at('retrieved_on', 'ERROR', 'BAD_DATE', 'retrieved_on must be YYYY-MM-DD');
    else if (r.retrieved_on > today)
      at('retrieved_on', 'ERROR', 'FUTURE_DATE', 'retrieved_on is in the future');
    if (isBlank(r.exact_words_copied) || isNotFound(r.exact_words_copied)) {
      at('exact_words_copied', 'ERROR', 'NO_QUOTE', 'the official words are missing');
    } else if (/(\.\.\.|…|\[\s*\.\.\.\s*\])/.test(r.exact_words_copied)) {
      at(
        'exact_words_copied',
        'WARN',
        'QUOTE_ELIDED',
        'the copied words contain "..." so they are not word for word',
      );
    }
    if (!['HIGH', 'MEDIUM', 'LOW'].includes(r.confidence))
      at('confidence', 'ERROR', 'BAD_ENUM', 'confidence must be HIGH / MEDIUM / LOW');
    if (!['YES', 'NO'].includes(r.needs_human_check))
      at('needs_human_check', 'ERROR', 'BAD_ENUM', 'needs_human_check must be YES or NO');
    if (r.confidence === 'HIGH' && r.needs_human_check === 'YES')
      at('confidence', 'WARN', 'CONTRADICTION', 'HIGH confidence but flagged for a human check');
    if (HEDGES.test(r.notes))
      at(
        'notes',
        'WARN',
        'HEDGED_NOTE',
        'the note hedges ("generally", "verify" ...): treat this row as unverified',
      );
    const english = /^english$/i.test(r.source_language);
    if (!english && isBlank(r.english_translation_if_not_english))
      at(
        'english_translation_if_not_english',
        'WARN',
        'NO_TRANSLATION',
        'non-English source without a translation',
      );
    if (english && !isBlank(r.english_translation_if_not_english))
      at(
        'english_translation_if_not_english',
        'INFO',
        'TRANSLATION_ON_ENGLISH',
        'translation given for an English source',
      );
  }

  // ---- countries
  const seenCountry = new Set();
  const seenIso = new Set();
  for (const r of data.countries ?? []) {
    const at = (field, sev, code, msg) => add('countries', r.__row, field, sev, code, msg);
    sourceChecks('countries', r);
    if (!/^[A-Z]{2}$/.test(r.iso2))
      at('iso2', 'ERROR', 'BAD_ISO', 'iso2 must be two capital letters');
    if (seenCountry.has(r.country.toLowerCase()))
      at('country', 'ERROR', 'DUPLICATE', 'country appears twice');
    if (seenIso.has(r.iso2)) at('iso2', 'ERROR', 'DUPLICATE', 'iso2 appears twice');
    seenCountry.add(r.country.toLowerCase());
    seenIso.add(r.iso2);
    const status = r.entry_status_for_bangladesh_ordinary_passport;
    const how = r.how_to_apply;
    if (!ENTRY_STATUS.includes(status))
      at(
        'entry_status',
        'ERROR',
        'BAD_ENUM',
        `entry status must be one of ${ENTRY_STATUS.join(' / ')}`,
      );
    if (!HOW_TO_APPLY.includes(how))
      at(
        'how_to_apply',
        'ERROR',
        'BAD_ENUM',
        `how_to_apply must be one of ${HOW_TO_APPLY.join(' / ')}`,
      );
    if (status === 'VISA_FREE' && how !== 'NONE')
      at('how_to_apply', 'WARN', 'CONTRADICTION', 'visa free but how_to_apply is not NONE');
    if (status === 'E_VISA' && how !== 'E_VISA_PORTAL')
      at('how_to_apply', 'WARN', 'CONTRADICTION', 'E_VISA but how_to_apply is not E_VISA_PORTAL');
    if (status === 'VISA_ON_ARRIVAL' && how !== 'ON_ARRIVAL')
      at(
        'how_to_apply',
        'WARN',
        'CONTRADICTION',
        'visa on arrival but how_to_apply is not ON_ARRIVAL',
      );
    if (status === 'VISA_REQUIRED' && how === 'E_VISA_PORTAL')
      at(
        'how_to_apply',
        'WARN',
        'CONTRADICTION',
        'visa required but applied through an e-visa portal: should this be E_VISA?',
      );
    if (!isNotFound(r.maximum_stay_days) && !/^\d+$/.test(r.maximum_stay_days))
      at(
        'maximum_stay_days',
        'ERROR',
        'BAD_NUMBER',
        'maximum stay must be a whole number of days or NOT_FOUND',
      );
    const quote = r.exact_words_copied;
    const quoteNums = numbersIn(quote);
    const claim = (field, value) => {
      if (isBlank(value) || isNotFound(value)) return;
      const n = String(value).replace(/,/g, '').replace(/\.0+$/, '');
      if (!/^\d/.test(n)) return;
      if (n !== '0' && !quoteNums.has(n))
        at(
          field,
          'WARN',
          'VALUE_NOT_IN_QUOTE',
          `${n} is not in the copied words, so this value has no proof in this row`,
        );
      if (n === '0')
        at(
          field,
          'WARN',
          'ZERO_UNPROVEN',
          '0 (free) needs words that say it is free; the copied words do not prove it',
        );
    };
    claim('official_fee_amount', r.official_fee_amount);
    claim('maximum_stay_days', r.maximum_stay_days);
    if (!isNotFound(r.official_fee_amount) && isNotFound(r.official_fee_currency))
      at('official_fee_currency', 'ERROR', 'FEE_PAIR', 'fee given without a currency');
    if (!isNotFound(r.official_fee_currency) && isNotFound(r.official_fee_amount))
      at('official_fee_amount', 'WARN', 'FEE_PAIR', 'currency given without a fee');
    if (!isNotFound(r.official_fee_currency) && !/^[A-Z]{3}$/.test(r.official_fee_currency))
      at('official_fee_currency', 'ERROR', 'BAD_CURRENCY', 'currency must be a three-letter code');
    if (
      status !== 'NOT_FOUND' &&
      !/bangladesh/i.test(`${quote} ${r.source_url} ${r.where_in_source}`)
    ) {
      at(
        'entry_status',
        'WARN',
        'NOT_ABOUT_BANGLADESH',
        'the copied words and page do not mention Bangladesh, so they cannot prove the status for Bangladeshis',
      );
    }
    if (
      /^visit, study, work, family, transit, business$/i.test(r.visa_routes_the_official_site_lists)
    ) {
      at(
        'visa_routes_the_official_site_lists',
        'WARN',
        'ROUTE_LIST_TEMPLATE',
        'the full six-route list is the same for many countries and is not proven by the copied words',
      );
    }
    if (
      !isNotFound(r.official_apply_url) &&
      r.official_apply_url &&
      !/^https:\/\//.test(r.official_apply_url)
    )
      at('official_apply_url', 'ERROR', 'BAD_URL', 'apply address must be a full https address');
  }

  // ---- routes
  const routeKeys = new Set();
  for (const r of data.routes ?? []) {
    const at = (field, sev, code, msg) => add('routes', r.__row, field, sev, code, msg);
    sourceChecks('routes', r);
    if (!/^[a-z0-9]+(\.[a-z0-9_]+)+$/.test(r.pack_key))
      at('pack_key', 'ERROR', 'BAD_KEY', 'pack_key must be lowercase like uk.visitor');
    if (routeKeys.has(r.pack_key)) at('pack_key', 'ERROR', 'DUPLICATE', 'pack_key appears twice');
    routeKeys.add(r.pack_key);
    if (!PURPOSES.includes(r.purpose))
      at('purpose', 'ERROR', 'BAD_ENUM', `purpose must be one of ${PURPOSES.join(' / ')}`);
    if (!isNotFound(r.rules_take_effect_on) && !isDate(r.rules_take_effect_on))
      at('rules_take_effect_on', 'ERROR', 'BAD_DATE', 'use YYYY-MM-DD or NOT_FOUND');
    if (!isNotFound(r.official_fee_amount) && !/^\d+(\.\d+)?$/.test(r.official_fee_amount))
      at('official_fee_amount', 'ERROR', 'BAD_NUMBER', 'fee must be a plain number or NOT_FOUND');
    if (!isNotFound(r.official_fee_amount) && isNotFound(r.official_fee_currency))
      at('official_fee_currency', 'ERROR', 'FEE_PAIR', 'fee given without a currency');
    if (!isNotFound(r.official_fee_currency) && !/^[A-Z]{3}$/.test(r.official_fee_currency))
      at('official_fee_currency', 'ERROR', 'BAD_CURRENCY', 'currency must be a three-letter code');
    const n = String(r.official_fee_amount).replace(/,/g, '').replace(/\.0+$/, '');
    if (/^\d/.test(n) && n !== '0' && !numbersIn(r.exact_words_copied).has(n)) {
      at(
        'official_fee_amount',
        'WARN',
        'FEE_NOT_IN_QUOTE',
        `fee ${n} is not in this row's copied words, so the fee has no proof; put it in its own requirement row with its own source`,
      );
    }
    if (n === '0')
      at(
        'official_fee_amount',
        'WARN',
        'ZERO_UNPROVEN',
        'a fee of 0 needs words that say it is free',
      );
    if (r.applies_to_nationality && !/bangladesh/i.test(r.applies_to_nationality))
      at('applies_to_nationality', 'WARN', 'NATIONALITY', 'expected Bangladesh');
    if (r.requirements_complete !== undefined && !['YES', 'NO'].includes(r.requirements_complete)) {
      at('requirements_complete', 'ERROR', 'BAD_ENUM', 'requirements_complete must be YES or NO');
    }
  }

  // ---- requirements
  const perRoute = new Map();
  const seenReq = new Set();
  for (const r of data.requirements ?? []) {
    const at = (field, sev, code, msg) => add('requirements', r.__row, field, sev, code, msg);
    sourceChecks('requirements', r);
    perRoute.set(r.pack_key, (perRoute.get(r.pack_key) ?? 0) + 1);
    if (data.routes && !routeKeys.has(r.pack_key))
      at('pack_key', 'ERROR', 'UNKNOWN_ROUTE', `${r.pack_key} has no row in the routes sheet`);
    if (!KINDS.includes(r.kind))
      at('kind', 'ERROR', 'BAD_ENUM', `kind must be one of ${KINDS.join(' / ')}`);
    if (!['required', 'optional'].includes(r.required_or_optional))
      at('required_or_optional', 'ERROR', 'BAD_ENUM', 'must be required or optional');
    const dupKey = `${r.pack_key}|${norm(r.what_is_required)}`;
    if (seenReq.has(dupKey))
      at(
        'what_is_required',
        'ERROR',
        'DUPLICATE',
        'the same requirement appears twice for this route',
      );
    seenReq.add(dupKey);
    if (r.kind === 'DETAIL' && PROCEDURE_WORDS.test(r.what_is_required)) {
      at(
        'kind',
        'WARN',
        'PROCESS_STEP',
        'this looks like a step to do (pay, attend, give biometrics), not a detail or a document: use kind PROCESS_STEP',
      );
    }
    if (!isBlank(r.must_be_dated_within_days)) {
      if (!/^[1-9]\d*$/.test(r.must_be_dated_within_days))
        at(
          'must_be_dated_within_days',
          'ERROR',
          'BAD_NUMBER',
          'must be a positive whole number of days or empty',
        );
      if (r.kind !== 'DOCUMENT')
        at(
          'must_be_dated_within_days',
          'ERROR',
          'AGE_ON_NON_DOCUMENT',
          'an age limit only applies to a document',
        );
      const q = r.exact_words_copied;
      if (COVERAGE.test(q) && !FRESHNESS.test(q)) {
        at(
          'must_be_dated_within_days',
          'WARN',
          'COVERAGE_NOT_AGE',
          'the words describe the period a statement must cover, not how old the document may be: leave this empty',
        );
      } else if (!FRESHNESS.test(q)) {
        at(
          'must_be_dated_within_days',
          'WARN',
          'NO_AGE_WORDS',
          'the copied words do not state an age limit',
        );
      }
    }
    const claimNums = numbersIn(r.what_is_required);
    const quoteNums = numbersIn(r.exact_words_copied);
    for (const num of claimNums) {
      if (!quoteNums.has(num)) {
        at(
          'what_is_required',
          'WARN',
          'NUMBER_NOT_IN_QUOTE',
          `${num} appears in the requirement but not in the copied words`,
        );
        break;
      }
    }
  }
  if (data.routes && data.requirements) {
    for (const key of routeKeys) {
      const count = perRoute.get(key) ?? 0;
      if (count === 0)
        add('routes', 0, 'pack_key', 'WARN', 'NO_REQUIREMENTS', `${key} has no requirement rows`);
      else if (count < 5)
        add(
          'routes',
          0,
          'pack_key',
          'WARN',
          'THIN_ROUTE',
          `${key} has only ${count} requirement row(s); a route this thin would show people as ready too early`,
        );
      const declared = data.routes.find((x) => x.pack_key === key)?.requirements_complete;
      if (declared === 'YES' && count < 3)
        add(
          'routes',
          0,
          'requirements_complete',
          'WARN',
          'COMPLETE_BUT_THIN',
          `${key} says its list is complete but has ${count} row(s)`,
        );
    }
  }
  return {
    findings,
    hosts,
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    perRoute,
    data,
  };
}

/** Text of a page, lower-cased and whitespace-collapsed, for finding copied words. */
const NAMED_ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '\u2013',
  mdash: '\u2014',
  middot: '\u00b7',
  bull: '\u2022',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  laquo: '\u00ab',
  raquo: '\u00bb',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  cent: '\u00a2',
  copy: '\u00a9',
  reg: '\u00ae',
  deg: '\u00b0',
  times: '\u00d7',
  eacute: '\u00e9',
  egrave: '\u00e8',
  ecirc: '\u00ea',
  agrave: '\u00e0',
  acirc: '\u00e2',
  ccedil: '\u00e7',
  ocirc: '\u00f4',
  ucirc: '\u00fb',
  icirc: '\u00ee',
  iuml: '\u00ef',
  ntilde: '\u00f1',
  uuml: '\u00fc',
  ouml: '\u00f6',
  auml: '\u00e4',
  szlig: '\u00df',
};

/** Turns the common HTML character codes (named, decimal and hex) into the characters they stand for. */
export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const value =
        code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(value) && value > 0 && value < 0x110000
        ? String.fromCodePoint(value)
        : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

export function pageText(html) {
  return norm(
    decodeEntities(
      String(html)
        .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
}

/** FOUND (exact), PARTIAL (most of it), or MISSING. Ignores case, spacing and quote style. */
export function quoteStatus(page, quote) {
  // Web pages often put a space before a full stop or comma ("Insurance ."), which the words do not have.
  const tidy = (text) =>
    text
      .replace(/[^\p{L}\p{N}$€£%.,'"/ -]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .replace(/ ([.,])/g, '$1');
  const q = tidy(norm(quote)).trim();
  const p = tidy(page);
  if (q.length === 0) return 'MISSING';
  if (p.includes(q)) return 'FOUND';
  const words = q.split(' ');
  if (words.length < 6) return 'MISSING';
  let hit = 0;
  let total = 0;
  for (let i = 0; i + 4 <= words.length; i += 1) {
    total += 1;
    if (p.includes(words.slice(i, i + 4).join(' '))) hit += 1;
  }
  return hit / total >= 0.8 ? 'PARTIAL' : 'MISSING';
}

export async function liveChecks(data, fetchPage, add, pool = 8) {
  const urls = [];
  for (const rows of Object.values(data)) {
    for (const r of rows) {
      const url = r.source_url;
      if (
        !isBlank(url) &&
        /^https:\/\//.test(url) &&
        !/\.pdf($|\?)/i.test(url) &&
        !urls.includes(url)
      )
        urls.push(url);
    }
  }
  const cache = new Map();
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const url = urls[next];
      next += 1;
      try {
        const res = await fetchPage(url);
        cache.set(url, res.ok ? { text: pageText(res.body) } : { error: `HTTP ${res.status}` });
      } catch (e) {
        cache.set(url, { error: String(e.message ?? e).slice(0, 80) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(pool, urls.length) }, worker));
  for (const [sheet, rows] of Object.entries(data)) {
    for (const r of rows) {
      const got = cache.get(r.source_url);
      if (!got) continue;
      if (got.error) {
        add(
          sheet,
          r.__row,
          'source_url',
          'WARN',
          'PAGE_UNREACHABLE',
          `could not open the page (${got.error}); a person must check`,
        );
        continue;
      }
      const status = quoteStatus(got.text, r.exact_words_copied);
      if (status === 'MISSING')
        add(
          sheet,
          r.__row,
          'exact_words_copied',
          'ERROR',
          'QUOTE_NOT_ON_PAGE',
          'the copied words were not found on the cited page',
        );
      else if (status === 'PARTIAL')
        add(
          sheet,
          r.__row,
          'exact_words_copied',
          'WARN',
          'QUOTE_PARTIAL',
          'only part of the copied words were found on the cited page',
        );
    }
  }
}

function toCsv(findings) {
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = ['sheet,row,field,severity,code,message'];
  for (const f of findings)
    lines.push([f.sheet, f.row, f.field, f.severity, f.code, f.message].map(esc).join(','));
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const sheets = {};
  for (const name of Object.keys(SHEET_COLUMNS)) {
    const path = get(`--${name}`);
    if (path) sheets[name] = parseCsv(readFileSync(path, 'utf8'));
  }
  const result = validateIntake(sheets);
  if (args.includes('--live')) {
    const fetchPage = async (url) => {
      const res = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; VisaStackIntakeCheck/1.0)',
          accept: 'text/html,*/*',
        },
        signal: AbortSignal.timeout(25000),
        redirect: 'follow',
      });
      return { ok: res.ok, status: res.status, body: res.ok ? await res.text() : '' };
    };
    await liveChecks(result.data, fetchPage, (sheet, row, field, severity, code, message) =>
      result.findings.push({ sheet, row, field, severity, code, message }),
    );
  }
  const out = get('--out');
  if (out) writeFileSync(out, toCsv(result.findings));
  const by = {};
  for (const f of result.findings) {
    const key = `${f.sheet} ${f.severity} ${f.code}`;
    by[key] = (by[key] ?? 0) + 1;
  }
  process.stdout.write(
    `${JSON.stringify({ rows: result.counts, findings: result.findings.length, by }, null, 2)}\n`,
  );
  const errors = result.findings.filter((f) => f.severity === 'ERROR').length;
  process.exit(errors > 0 ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

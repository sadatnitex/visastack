import { appendFileSync } from 'node:fs';

/** A name that must be present and non-empty, or (with `is`) exactly equal to that word. */
const need = (name, is) => (is ? { name, is } : { name });

export const GROUPS = {
  core: [
    need('PLAYWRIGHT_BASE_URL'),
    need('E2E_EXPECTED_SHA'),
    need('E2E_STAGING_DEPLOYMENT_ID'),
    need('E2E_SYNTHETIC_ISOLATION_VERIFIED', 'true'),
    need('STAGING_ATTESTATION_SECRET'),
    need('STAGING_VERCEL_TOKEN'),
  ],
  traveller: [
    need('NEON_STAGING_TRAVELLER_EMAIL'),
    need('NEON_STAGING_TRAVELLER_PASSWORD'),
    need('E2E_TRAVELLER_ID'),
  ],
  agency: [
    need('NEON_STAGING_AGENCY_ADMIN_EMAIL'),
    need('NEON_STAGING_AGENCY_ADMIN_PASSWORD'),
    need('E2E_AGENCY_ORG_ID'),
  ],
  unrelated: [
    need('NEON_STAGING_UNRELATED_AGENCY_ADMIN_EMAIL'),
    need('NEON_STAGING_UNRELATED_AGENCY_ADMIN_PASSWORD'),
    need('E2E_UNRELATED_AGENCY_ORG_ID'),
  ],
  case: [
    need('E2E_UK_TOURISM_PACK_SEEDED', 'true'),
    need('E2E_UK_TOURISM_PACK_LABEL'),
    need('E2E_UNSUPPORTED_ROUTE_DESTINATION'),
  ],
  ui: [need('E2E_CASE_ID')],
  // Lanes D and E (exact copy and the agency loop). The owner sets these to "true" only once the
  // feature is merged, deployed to the staging deployment and its migration is applied there.
  exactCopy: [need('E2E_EXACT_COPY_SERVICE_VERIFIED', 'true'), need('E2E_ACCESS_SEEDED', 'true')],
  guest: [
    need('E2E_GUEST_INBOX_URL'),
    need('E2E_GUEST_INBOX_TOKEN'),
    need('E2E_GUEST_RECIPIENT_EMAIL'),
  ],
};

/** Only read when the sign-in page asks for a second step (see support/session.ts). */
export const OPTIONAL_NAMES = [
  'NEON_STAGING_TRAVELLER_TOTP_SECRET',
  'NEON_STAGING_AGENCY_ADMIN_TOTP_SECRET',
  'NEON_STAGING_UNRELATED_AGENCY_ADMIN_TOTP_SECRET',
];

/** Which groups each spec file needs. A spec whose groups are not all present is BLOCKED. */
export const SUITES = {
  traveller: { files: ['traveller.spec.ts'], groups: ['core', 'traveller'] },
  case: { files: ['case-pack.spec.ts'], groups: ['core', 'traveller', 'case'] },
  isolation: {
    files: ['agency-isolation.spec.ts'],
    groups: ['core', 'traveller', 'agency', 'unrelated'],
  },
  loop: {
    files: ['agency-loop.spec.ts', 'agency-loop-revoke.spec.ts'],
    groups: ['core', 'traveller', 'agency', 'exactCopy'],
  },
  // The flagship journey: answer several requests from saved records, one receipt naming each exact copy.
  records: {
    files: ['answer-from-records.spec.ts'],
    groups: ['core', 'traveller', 'agency', 'unrelated', 'exactCopy'],
  },
  guest: { files: ['guest-request.spec.ts'], groups: ['core', 'agency', 'guest'] },
  ui: {
    files: ['responsive-a11y.spec.ts', 'session-expiry.spec.ts', 'performance.spec.ts'],
    groups: ['core', 'traveller', 'agency', 'ui'],
  },
};

/**
 * Specs that end or change a grant that other specs rely on, in the order they must run. They run
 * in their own last stages (apps/web/playwright.signed-in.config.ts keeps the same list, one project
 * for each, each waiting for the one before), after every other spec, and `filesFor` puts them last
 * in this order. scripts/staging-journeys.test.mjs fails if the two lists drift or if any other
 * spec touches a grant.
 */
export const LAST_STAGE_SPECS = ['answer-from-records.spec.ts', 'agency-loop-revoke.spec.ts'];

/** Every setting name this suite can read. */
export function allNames() {
  return [
    ...new Set([
      ...Object.values(GROUPS)
        .flat()
        .map((entry) => entry.name),
      ...OPTIONAL_NAMES,
    ]),
  ];
}

/** The names in `group` that are missing or not the required word. Names only. */
export function missingIn(group, env) {
  return GROUPS[group]
    .filter((entry) => {
      const value = env[entry.name];
      if (value === undefined || value === '') return true;
      return entry.is !== undefined && value !== entry.is;
    })
    .map((entry) => entry.name);
}

/** Three accounts, three different addresses: one account on both sides proves nothing. */
export function sharedIdentities(env) {
  const emails = [
    env.NEON_STAGING_TRAVELLER_EMAIL,
    env.NEON_STAGING_AGENCY_ADMIN_EMAIL,
    env.NEON_STAGING_UNRELATED_AGENCY_ADMIN_EMAIL,
  ].filter(Boolean);
  const lower = emails.map((email) => email.toLowerCase());
  const orgs = [env.E2E_AGENCY_ORG_ID, env.E2E_UNRELATED_AGENCY_ORG_ID].filter(Boolean);
  return lower.length !== new Set(lower).size || orgs.length !== new Set(orgs).size;
}

/** One line per suite: ready, or BLOCKED with the missing names. */
export function report(env) {
  const lines = [];
  for (const [suite, { files, groups }] of Object.entries(SUITES)) {
    const missing = groups.flatMap((group) => missingIn(group, env));
    lines.push(
      missing.length === 0
        ? `ready    ${suite} (${files.join(', ')})`
        : `BLOCKED  ${suite} (${files.join(', ')}): missing ${[...new Set(missing)].join(', ')}`,
    );
  }
  if (sharedIdentities(env)) {
    lines.push('BLOCKED  identities: two accounts or two agencies are the same one');
  }
  return lines;
}

/** The spec files of one suite (or of all of them), one per line, for the workflow to run. */
export function filesFor(suite) {
  const found =
    suite === 'all'
      ? [...new Set(Object.values(SUITES).flatMap((s) => s.files))]
      : SUITES[suite]?.files;
  if (!found) throw new Error(`No suite named ${suite}`);
  return [
    ...found.filter((file) => !LAST_STAGE_SPECS.includes(file)),
    ...LAST_STAGE_SPECS.filter((file) => found.includes(file)),
  ];
}

/**
 * The default command: one line per suite, ready or BLOCKED with the missing setting names (never a
 * value), printed and, inside a workflow run, added to the run summary under a heading. It always
 * ends normally: a blocked suite is reported here and fails where it would run, so this step can
 * never hide behind its own exit code.
 */
export function runReport(env = process.env, summaryFile = env.GITHUB_STEP_SUMMARY) {
  const lines = report(env);
  for (const line of lines) console.info(line);
  if (summaryFile) {
    const body = ['### Signed-in journey setup', '', ...lines.map((line) => `- ${line}`), ''];
    appendFileSync(summaryFile, `${body.join('\n')}\n`);
  }
  return lines;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv[2] === '--files') {
    try {
      console.info(filesFor(process.argv[3] ?? 'all').join('\n'));
    } catch {
      console.error('BLOCKED: that is not a suite of signed-in journeys.');
      process.exitCode = 1;
    }
  } else {
    runReport();
  }
}

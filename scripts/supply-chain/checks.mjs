// Supply-chain checks that really run on a private repository.
// No third-party scanner is needed: every check here is plain Node and reads
// files from git. Each check returns { id, title, status, detail, findings }.
// status is one of: passed, failed, skipped. A skipped check is never a pass.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_FILE_BYTES = 2_000_000;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');
  return out.split('\0').filter(Boolean);
}

function readText(root, file) {
  const full = join(root, file);
  try {
    const st = statSync(full);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    const buf = readFileSync(full);
    if (buf.includes(0)) return null; // binary
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

const isTestFile = (f) =>
  /(^|\/)(e2e|test|tests|__tests__|fixtures?)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const isSourceFile = (f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f);

function result(id, title, findings, detail) {
  return {
    id,
    title,
    status: findings.length === 0 ? 'passed' : 'failed',
    detail,
    findings,
  };
}

function skipped(id, title, detail) {
  return { id, title, status: 'skipped', detail, findings: [] };
}

// ---------------------------------------------------------------------------
// Secret patterns (shared by secret scan, fixture check and prompt check)
// ---------------------------------------------------------------------------

export const SECRET_PATTERNS = [
  {
    name: 'private key block',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  },
  { name: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    name: 'GitHub token',
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
  },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe live key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
  { name: 'WorkOS key', re: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'OpenAI key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Resend key', re: /\bre_[A-Za-z0-9]{20,}\b/ },
  { name: 'Vercel blob token', re: /\bvercel_blob_rw_[A-Za-z0-9_]{20,}\b/ },
  { name: 'Vercel token', re: /\bvcp_[A-Za-z0-9]{20,}\b/ },
  {
    name: 'database URL with password',
    re: /\bpostgres(?:ql)?:\/\/[^\s:@/'"`]+:(?!password\b|pass\b|test\b|postgres\b|\$|\{|<|x+\b)[^\s@/'"`]{6,}@(?!localhost|127\.0\.0\.1|db\b|postgres\b)[A-Za-z0-9.-]+/,
  },
  {
    name: 'JSON web token',
    re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/,
  },
];

// Lines carrying this marker are reviewed and accepted. Each use needs a reason.
const ALLOW_MARKER = 'supply-chain-allow';

function scanLines(text, file, patterns, label) {
  const found = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW_MARKER)) continue;
    for (const p of patterns) {
      if (p.re.test(line)) {
        found.push(`${file}:${i + 1} ${label ?? 'matches'} ${p.name}`);
      }
    }
  }
  return found;
}

export function scanTextForSecrets(text, file) {
  return scanLines(text, file, SECRET_PATTERNS, 'looks like a');
}

// ---------------------------------------------------------------------------
// 1. Secret scan: working tree plus git history (added lines only)
// ---------------------------------------------------------------------------

export function checkSecrets(root, files = trackedFiles(root), opts = {}) {
  const findings = [];
  let scanned = 0;
  for (const f of files) {
    if (f === 'pnpm-lock.yaml' || f === 'scripts/supply-chain/checks.mjs') continue;
    if (f === 'scripts/supply-chain/checks.test.mjs') continue;
    const text = readText(root, f);
    if (text === null) continue;
    scanned++;
    findings.push(...scanTextForSecrets(text, f));
  }

  let historyNote = '';
  const shallow = (() => {
    try {
      return (
        execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: root })
          .toString()
          .trim() === 'true'
      );
    } catch {
      return true;
    }
  })();
  if (opts.history !== false && !shallow) {
    const log = execFileSync(
      'git',
      ['log', '--all', '-p', '--no-color', '--diff-filter=AM', '-U0', '--format=commit %H'],
      { cwd: root, maxBuffer: 1024 * 1024 * 1024 },
    ).toString('utf8');
    let commit = '';
    let file = '';
    for (const line of log.split('\n')) {
      if (line.startsWith('commit ')) commit = line.slice(7, 15);
      else if (line.startsWith('+++ b/')) file = line.slice(6);
      else if (line.startsWith('+') && !line.startsWith('+++')) {
        if (file === 'pnpm-lock.yaml' || file.startsWith('scripts/supply-chain/checks')) continue;
        if (line.includes(ALLOW_MARKER)) continue;
        for (const p of SECRET_PATTERNS) {
          if (p.re.test(line)) findings.push(`history ${commit} ${file} looks like a ${p.name}`);
        }
      }
    }
    historyNote = ' Full git history scanned (added lines on every branch).';
  } else if (opts.history !== false) {
    historyNote = ' History NOT scanned: this clone is shallow (working tree only).';
  }
  const unique = [...new Set(findings)];
  return result(
    'secret-scan',
    'Secret scan',
    unique,
    `${scanned} tracked text files scanned against ${SECRET_PATTERNS.length} patterns.${historyNote}`,
  );
}

// ---------------------------------------------------------------------------
// 2. Licence scan: production dependency licences against a deny list
// ---------------------------------------------------------------------------

const DENIED_LICENCE =
  /\b(?:AGPL|GPL|LGPL|SSPL|BUSL|Commons-Clause|CC-BY-NC|Elastic|Unlicense-NC)\b/i;

// Reviewed exceptions, by exact package name. Each needs a reason. An LGPL library that is
// shipped as a separate, replaceable binary and not modified is allowed by the licence.
export const LICENCE_EXCEPTIONS = {
  '@img/sharp-libvips-linux-x64':
    'LGPL image library used by Next.js image optimisation; separate unmodified shared binary, replaceable',
  '@img/sharp-libvips-linuxmusl-x64': 'same as above, musl build',
  '@img/sharp-libvips-linux-arm64': 'same as above, arm build',
  '@img/sharp-libvips-linuxmusl-arm64': 'same as above, arm musl build',
  '@img/sharp-libvips-darwin-arm64': 'same as above, Mac build',
  '@img/sharp-libvips-darwin-x64': 'same as above, Mac build',
  'libheif-js':
    'LGPL HEIC decoder (libheif built to WebAssembly) used only on the server, in its own worker thread, to turn iPhone photos into JPEG copies; unmodified package from npm, loaded at run time from its own files and never bundled (next.config.mjs, packages/adapters/src/heic-worker.cjs), so it stays a separate, replaceable library',
};

export function classifyLicences(byLicence) {
  const denied = [];
  const unknown = [];
  const accepted = [];
  for (const [licence, pkgs] of Object.entries(byLicence)) {
    const names = pkgs.map((p) => `${p.name}@${(p.versions ?? [p.version ?? '?']).join(',')}`);
    if (!licence || /^(unknown|unlicensed|see license)/i.test(licence)) {
      unknown.push(...names.map((n) => `${n} (${licence || 'no licence field'})`));
    } else if (
      DENIED_LICENCE.test(licence) &&
      !/^\(?(?:MIT|Apache-2\.0|BSD)/i.test(licence.split(/ OR /i)[0] ?? '')
    ) {
      // An OR expression with a permissive first option is acceptable.
      const permissiveChoice =
        /\bOR\b/i.test(licence) && /\b(?:MIT|Apache-2\.0|BSD-[23]-Clause|ISC)\b/.test(licence);
      if (!permissiveChoice) {
        for (const p of pkgs) {
          const n = `${p.name}@${(p.versions ?? [p.version ?? '?']).join(',')} (${licence})`;
          if (p.name in LICENCE_EXCEPTIONS) accepted.push(`${n}: ${LICENCE_EXCEPTIONS[p.name]}`);
          else denied.push(n);
        }
      }
    }
  }
  return { denied, unknown, accepted };
}

export function checkLicences(root, run = defaultLicenceRunner) {
  let json;
  try {
    json = run(root);
  } catch (err) {
    return skipped(
      'licence-scan',
      'Licence scan',
      `Could not list licences: ${String(err.message).slice(0, 160)}`,
    );
  }
  const { denied, unknown, accepted } = classifyLicences(json);
  const total = Object.values(json).reduce((n, p) => n + p.length, 0);
  const r = result(
    'licence-scan',
    'Licence scan',
    denied.map((d) => `denied licence: ${d}`),
    `${total} production packages across ${Object.keys(json).length} licence types.${
      accepted.length ? ` ${accepted.length} reviewed exception(s): ${accepted.join('; ')}.` : ''
    }${
      unknown.length
        ? ` ${unknown.length} with no declared licence (reported, not blocking): ${unknown.slice(0, 5).join('; ')}.`
        : ''
    }`,
  );
  return r;
}

function defaultLicenceRunner(root) {
  const out = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
  }).toString('utf8');
  return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// 3. Static analysis: dangerous patterns in shipped source (not tests)
// ---------------------------------------------------------------------------

export const STATIC_RULES = [
  { name: 'eval call', re: /(?<![\w.])eval\s*\(/ },
  { name: 'Function constructor', re: /\bnew\s+Function\s*\(/ },
  { name: 'dangerouslySetInnerHTML', re: /dangerouslySetInnerHTML\s*[=:]/ },
  { name: 'innerHTML assignment', re: /\.(?:inner|outer)HTML\s*=(?!=)/ },
  { name: 'document.write', re: /document\.write\s*\(/ },
  {
    name: 'TLS verification disabled',
    re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/,
  },
  { name: 'weak hash (md5/sha1)', re: /createHash\(\s*['"](?:md5|sha1)['"]/ },
  {
    name: 'shell execution',
    // Direct executable calls do not invoke a shell unless explicitly enabled.
    // Keep rejecting all other child_process imports and shell-enabled options.
    re: /\b(?:exec|execSync)\s*\(|shell\s*:\s*(?!false\b)[^\s,}]+|import\s+(?!\{\s*execFile(?:Sync)?\s*\}\s+from)[^;\n]*['"](?:node:)?child_process['"]|require\s*\(\s*['"](?:node:)?child_process['"]/,
  },
  {
    name: 'Math.random for security value',
    re: /(?:token|secret|nonce|password|salt|key)\w*\s*[:=][^;\n]*Math\.random\s*\(/i,
  },
  { name: 'wildcard CORS', re: /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]/ },
];

export function checkStaticAnalysis(root, files = trackedFiles(root)) {
  const findings = [];
  let scanned = 0;
  for (const f of files) {
    if (!isSourceFile(f) || isTestFile(f) || f.startsWith('scripts/supply-chain/')) continue;
    if (!/^(apps|packages)\//.test(f)) continue;
    if (/\.test-support\.[tj]sx?$/.test(f)) continue;
    const text = readText(root, f);
    if (text === null) continue;
    scanned++;
    findings.push(...scanLines(text, f, STATIC_RULES, 'uses'));
  }
  return result(
    'static-analysis',
    'Static analysis (rule-based)',
    findings,
    `${scanned} shipped source files checked against ${STATIC_RULES.length} rules. This does NOT replace CodeQL, which needs a public repository or paid code scanning; type checking and the Biome lint run separately in the same job.`,
  );
}

// ---------------------------------------------------------------------------
// 4. Browser bundle: no server secret names or server-only code in client files
// ---------------------------------------------------------------------------

const SECRET_NAME =
  /(?:KEY|SECRET|TOKEN|PASSWORD|MASTER|DATABASE_URL|POSTGRES_URL|COOKIE_PASSWORD)/;

export function serverSecretNames(root) {
  const p = join(root, '.env.example');
  if (!existsSync(p)) return [];
  const names = new Set();
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^([A-Z][A-Z0-9_]+)=/.exec(line);
    if (m?.[1] && SECRET_NAME.test(m[1]) && !m[1].startsWith('NEXT_PUBLIC_')) names.add(m[1]);
  }
  return [...names];
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const SERVER_ONLY_MARKERS = [
  {
    name: 'database driver',
    re: /@neondatabase\/serverless|drizzle-orm\/neon|new Pool\s*\(\s*\{\s*connectionString/,
  },
  { name: 'server master key reader', re: /KMS_LOCAL_MASTER_KEY/ },
  { name: 'virus scanner client', re: /clamd|CLAMAV_/i },
  {
    name: 'server-only directive text',
    re: /This module cannot be imported from a Client Component module/,
  },
];

export function checkBrowserBundle(root, staticDir = join(root, 'apps/web/.next/static')) {
  if (!existsSync(staticDir)) {
    return skipped(
      'browser-bundle',
      'Browser bundle check',
      'No production build found (apps/web/.next/static). Build first; this is reported as skipped, not passed.',
    );
  }
  const names = serverSecretNames(root);
  const findings = [];
  const files = walk(staticDir);
  let scanned = 0;
  for (const full of files) {
    const rel = full.slice(root.length + 1);
    if (full.endsWith('.map')) {
      findings.push(
        `${rel} is a source map shipped to browsers (exposes server and client source)`,
      );
      continue;
    }
    if (!/\.(js|css|html|json|txt)$/.test(full)) continue;
    if (statSync(full).size > 20_000_000) continue;
    const text = readFileSync(full, 'utf8');
    scanned++;
    for (const n of names) {
      if (text.includes(n)) findings.push(`${rel} contains server variable name ${n}`);
    }
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(text)) findings.push(`${rel} contains something that looks like a ${p.name}`);
    }
    for (const m of SERVER_ONLY_MARKERS) {
      if (m.re.test(text)) findings.push(`${rel} contains ${m.name}`);
    }
  }
  return result(
    'browser-bundle',
    'Browser bundle check',
    findings,
    `${scanned} browser files scanned for ${names.length} server variable names, ${SECRET_PATTERNS.length} secret patterns, ${SERVER_ONLY_MARKERS.length} server-only markers and source maps.`,
  );
}

// ---------------------------------------------------------------------------
// 5. Prompt check: AI prompts hold no secrets, no environment values, no
//    real-looking personal data
// ---------------------------------------------------------------------------

const PROMPT_DECL =
  /\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*PROMPT[A-Z0-9_]*|[a-z][A-Za-z0-9]*(?:Prompt|Instruction)[A-Za-z0-9]*)\s*(?::[^=]+)?=\s*`/g;

export function extractPromptBodies(text) {
  const bodies = [];
  PROMPT_DECL.lastIndex = 0;
  for (let m = PROMPT_DECL.exec(text); m; m = PROMPT_DECL.exec(text)) {
    const start = PROMPT_DECL.lastIndex;
    let i = start;
    while (i < text.length && !(text[i] === '`' && text[i - 1] !== '\\')) i++;
    bodies.push({
      name: m[1],
      body: text.slice(start, i),
      line: text.slice(0, start).split('\n').length,
    });
  }
  return bodies;
}

export function checkPromptBody(name, body, file, line) {
  const found = [];
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(body))
      found.push(`${file}:${line} prompt ${name} contains something that looks like a ${p.name}`);
  }
  if (/process\.env|import\.meta\.env/.test(body))
    found.push(`${file}:${line} prompt ${name} reads an environment value`);
  for (const m of body.matchAll(/\$\{([^}]*)\}/g)) {
    if (SECRET_NAME.test(m[1] ?? '') || /env/i.test(m[1] ?? '')) {
      found.push(`${file}:${line} prompt ${name} interpolates ${(m[1] ?? '').trim()}`);
    }
  }
  for (const m of body.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
    if (!/(^|\.)(example\.(com|org|net)|test|invalid|localhost)$/i.test(m[1] ?? '')) {
      found.push(
        `${file}:${line} prompt ${name} contains an email address on a real-looking domain`,
      );
    }
  }
  return found;
}

export function checkPrompts(root, files = trackedFiles(root)) {
  const findings = [];
  let prompts = 0;
  let scanned = 0;
  for (const f of files) {
    if (!isSourceFile(f) || isTestFile(f)) continue;
    if (!/^(apps|packages)\//.test(f)) continue;
    const text = readText(root, f);
    if (text === null || !/PROMPT|Prompt|Instruction/.test(text)) continue;
    scanned++;
    for (const b of extractPromptBodies(text)) {
      prompts++;
      findings.push(...checkPromptBody(b.name, b.body, f, b.line));
    }
  }
  if (prompts === 0) {
    return skipped(
      'prompt-check',
      'Prompt check',
      'No prompt templates were found; the finder may be out of date.',
    );
  }
  return result(
    'prompt-check',
    'Prompt check',
    findings,
    `${prompts} prompt templates in ${scanned} files checked for secrets, environment values and real-looking email addresses.`,
  );
}

// ---------------------------------------------------------------------------
// 6. Fixture check: test data holds no production credential or address
// ---------------------------------------------------------------------------

const PRODUCTION_HOSTS = [
  { name: 'production Neon database host', re: /[a-z0-9-]+\.neon\.tech/ },
  {
    name: 'production blob store host',
    re: /[a-z0-9-]+\.(?:public|private)\.blob\.vercel-storage\.com/,
  },
  { name: 'live key', re: /\b(?:sk|pk|rk)_live_[A-Za-z0-9]{20,}/ },
  { name: 'production login cookie value', re: /wos-session=[A-Za-z0-9%._-]{40,}/ },
];

export function checkFixtures(root, files = trackedFiles(root)) {
  const findings = [];
  let scanned = 0;
  for (const f of files) {
    if (!isTestFile(f) && !/(^|\/)(seed|fixtures?|mocks?)\b/.test(f)) continue;
    if (f.startsWith('scripts/supply-chain/')) continue;
    const text = readText(root, f);
    if (text === null) continue;
    scanned++;
    findings.push(...scanTextForSecrets(text, f));
    findings.push(...scanLines(text, f, PRODUCTION_HOSTS, 'references'));
  }
  return result(
    'fixture-check',
    'Test fixture check',
    [...new Set(findings)],
    `${scanned} test, seed and fixture files checked for secrets, production hosts and live keys.`,
  );
}

// ---------------------------------------------------------------------------
// 7. Preview credential check: workflows and config cannot hand production
//    credentials to a pull request preview
// ---------------------------------------------------------------------------

// Workflows that may read repository secrets, and why. Everything else must not.
export const SECRET_WORKFLOW_ALLOWLIST = {
  'document-intake.yml':
    'scheduled or dispatched main-only isolated ClamAV worker, private queue, no checkout credentials',
  'database-backup.yml':
    'scheduled or manual, main-only, read-only checkout, encrypted private R2 output',
  'database-restore-drill.yml':
    'manual main-only, private temporary PostgreSQL, restricted restore role, read-only R2 input',
  'db-migrate.yml': 'manual, main-only, protected environment',
  'workos-staging-e2e.yml': 'legacy staging diagnostics only; never Neon acceptance',
  'neon-staging-routes.yml':
    'manual main-only reviewed revision, independent staging proof before synthetic credentials, no checkout credentials',
  'live-signed-in-check.yml':
    'production deployment or manual run only, live-check environment limited to main, read-only test account sign-in, no checkout credentials, no report upload',
};

export function checkPreviewCredentials(root, files = trackedFiles(root)) {
  const findings = [];
  const workflows = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
  for (const f of workflows) {
    const text = readText(root, f) ?? '';
    const base = f.split('/').pop() ?? f;
    if (/pull_request_target/.test(text.replace(/^\s*#.*$/gm, ''))) {
      findings.push(`${f} uses pull_request_target, which runs untrusted code with secrets`);
    }
    const usesSecrets = /\$\{\{\s*secrets\.(?!GITHUB_TOKEN)/.test(text);
    if (usesSecrets && !(base in SECRET_WORKFLOW_ALLOWLIST)) {
      findings.push(`${f} reads repository secrets but is not in the reviewed allowlist`);
    }
    if (usesSecrets && base in SECRET_WORKFLOW_ALLOWLIST && /^\s*pull_request\s*:/m.test(text)) {
      findings.push(`${f} reads repository secrets on pull_request events`);
    }
    if (
      (base === 'database-backup.yml' || base === 'database-restore-drill.yml') &&
      usesSecrets &&
      (!/^\s*if:\s*github\.ref == 'refs\/heads\/main'\s*$/m.test(text) ||
        !/^\s*persist-credentials:\s*false\s*$/m.test(text))
    ) {
      findings.push(`${f} must restrict backup secrets to main and discard checkout credentials`);
    }
    if (
      base === 'neon-staging-routes.yml' &&
      usesSecrets &&
      (!/^\s*if:\s*github\.ref == 'refs\/heads\/main'\s*$/m.test(text) ||
        !/^\s*persist-credentials:\s*false\s*$/m.test(text) ||
        !/^\s*workflow_dispatch\s*:/m.test(text) ||
        !text.includes('node scripts/check-staging-target.mjs'))
    ) {
      findings.push(
        `${f} must use manual main-only reviewed code, discard checkout credentials and verify staging before login`,
      );
    }
    if (base === 'live-signed-in-check.yml' && usesSecrets) {
      const allowedSecrets = new Set(['LIVE_CHECK_EMAIL', 'LIVE_CHECK_PASSWORD']);
      for (const match of text.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)/g)) {
        if (!allowedSecrets.has(match[1] ?? ''))
          findings.push(`${f} requests a secret outside the live test account`);
      }
      if (
        !/^\s*environment:\s*live-check\s*$/m.test(text) ||
        !/^\s*persist-credentials:\s*false\s*$/m.test(text) ||
        /^\s*(?:push|pull_request|schedule|workflow_run)\s*:/m.test(text) ||
        /upload-artifact/.test(text)
      ) {
        findings.push(
          `${f} must run in the main-only live-check environment, discard checkout credentials, start only after a deployment or by hand, and upload nothing`,
        );
      }
    }
    if (base === 'database-restore-drill.yml') {
      const allowed = new Set([
        'BACKUP_ENCRYPTION_KEY_BASE64',
        'R2_REGION',
        'R2_ENDPOINT_URL',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
      ]);
      for (const match of text.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)/g)) {
        if (!allowed.has(match[1]))
          findings.push(`${f} requests a secret outside isolated recovery`);
      }
      if (
        !/^\s*workflow_dispatch:\s*$/m.test(text) ||
        /^\s*(?:push|schedule|workflow_run|pull_request)\s*:/m.test(text)
      )
        findings.push(`${f} must be manually dispatched only`);
    }
    if (
      base === 'document-intake.yml' &&
      usesSecrets &&
      (!/^\s*if:\s*github\.ref == 'refs\/heads\/main' && vars\.DOCUMENT_INTAKE_ENABLED == 'true'\s*$/m.test(
        text,
      ) ||
        !/^\s*persist-credentials:\s*false\s*$/m.test(text))
    ) {
      findings.push(
        `${f} must restrict intake secrets to enabled main code and discard checkout credentials`,
      );
    }
    if (/^\s*persist-credentials\s*:\s*true/m.test(text)) {
      findings.push(`${f} keeps the checkout credential on disk`);
    }
  }
  const envFiles = files.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));
  for (const f of envFiles) findings.push(`${f} is a committed environment file`);

  const example = readText(root, '.env.example') ?? '';
  for (const line of example.split('\n')) {
    const m = /^([A-Z][A-Z0-9_]+)=(.+)$/.exec(line.trim());
    if (
      m?.[1] &&
      SECRET_NAME.test(m[1]) &&
      m[2] &&
      !/^(?:<|your|changeme|example|replace)/i.test(m[2])
    ) {
      findings.push(`.env.example gives a value to ${m[1]}; keep secret keys empty`);
    }
  }
  for (const f of ['apps/web/vercel.json', 'vercel.json']) {
    const t = readText(root, f);
    if (t && new RegExp(`(?:${SECRET_NAME.source})\\w*"\\s*:\\s*"[^"@$]`).test(t)) {
      findings.push(`${f} sets a secret-looking value directly`);
    }
  }
  return result(
    'preview-credentials',
    'Preview credential check',
    findings,
    `${workflows.length} workflow files, committed environment files and vercel config checked. Vercel project variable scoping (which variables a preview can see) cannot be read from code: the owner confirms it in the Vercel dashboard.`,
  );
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function summarise(results) {
  const counts = { executed: 0, passed: 0, failed: 0, skipped: 0 };
  for (const r of results) {
    if (r.status === 'skipped') counts.skipped++;
    else counts.executed++;
    if (r.status === 'passed') counts.passed++;
    if (r.status === 'failed') counts.failed++;
  }
  return counts;
}

export function toMarkdown(results, title = 'Supply-chain checks') {
  const c = summarise(results);
  const lines = [
    `## ${title}`,
    '',
    `Executed ${c.executed} | Passed ${c.passed} | Failed ${c.failed} | Skipped ${c.skipped}`,
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
  ];
  for (const r of results) {
    lines.push(`| ${r.title} | ${r.status.toUpperCase()} | ${r.detail.replace(/\|/g, '/')} |`);
  }
  for (const r of results) {
    if (r.findings.length) {
      lines.push('', `### ${r.title}: findings`, ...r.findings.slice(0, 50).map((f) => `- ${f}`));
    }
  }
  return `${lines.join('\n')}\n`;
}

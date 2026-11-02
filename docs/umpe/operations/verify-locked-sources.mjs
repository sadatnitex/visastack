import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = {
  'UMPE_LOCKED_Master_Product_Experience_v1.0_2026-11-02.md':
    '08376df42258945de47dc0b20ebf61b72a33e6f5f5a3b9abf3a17a7fc18060c8',
  'UMPE_Requirement_to_Repository_Audit_and_Execution_Plan_2026-11-02.md':
    'c8b13d2228888e2046c371a591a0c9e99b63668cb75917cbdc6f59911c76755b',
  'VisaStack_Field_Workflows_and_Document_Journeys_LOCKED_v1_2026-11-01.md':
    '483391fc2ada8c141dea7def03dfe1057095748dbd0821b530154b83643c3f4b',
};
let invalid = 0;
for (const [name, hash] of Object.entries(EXPECTED)) {
  try {
    const original = gunzipSync(readFileSync(resolve(root, 'originals', `${name}.gz`)));
    const digest = createHash('sha256').update(original).digest('hex');
    const view = readFileSync(resolve(root, 'source', name), 'utf8');
    const matches = original.toString('utf8').replaceAll('\u2014', '--') === view;
    const pass = digest === hash && matches;
    console.info(
      `${pass ? 'PASS' : 'FAIL'} ${name}: original sha256=${digest}; exact view normalization=${matches}`,
    );
    if (!pass) invalid++;
  } catch (e) {
    console.error(`FAIL ${name}: ${e.message}`);
    invalid++;
  }
}
if (invalid) {
  process.exitCode = 1;
  console.error('Locked source integrity check failed');
} else console.info('All original source bytes and repo-safe working views verified');

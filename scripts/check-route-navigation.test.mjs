import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { auditNavigation } from './check-route-navigation.mjs';

function fixture(t, pages, navigation) {
  const root = mkdtempSync(join(tmpdir(), 'visastack-navigation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packages'));
  for (const page of pages) {
    const file = join(root, 'apps/web/src/app', page, 'page.tsx');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'export default function Page() { return <main />; }');
  }
  writeFileSync(join(root, 'apps/web/src/navigation.tsx'), navigation);
  return auditNavigation(root);
}

test('scoped entity destinations, GET forms and invitation routes stay connected', (t) => {
  const report = fixture(
    t,
    [
      '',
      'app/agency/[orgId]',
      'app/applicant/[id]',
      'app/invitations/accept',
      'app/admin/packs/[packId]/diff',
    ],
    `
    const home = { href: '/' };
    function agency(orgId) { const base = '/app/agency/' + orgId; return <a href={base}>Agency</a>; }
    function applicant(id) { const base = '/app/applicant/' + id; return <a href={base}>Applicant</a>; }
    const acceptUrl = '/app/invitations/accept?token=synthetic';
    function diff(packId) { return <form method="get" action={'/app/admin/packs/' + packId + '/diff'} />; }
  `,
  );
  assert.deepEqual(report.invalid, []);
  assert.deepEqual(report.uncovered, []);
});

test('a destination that has no route is rejected', (t) => {
  const report = fixture(
    t,
    [''],
    "const links = [{ href: '/' }, { href: '/app/does-not-exist' }];",
  );
  assert.equal(report.invalid.length, 1);
  assert.equal(report.invalid[0].target, '/app/does-not-exist');
});

test('adding a page without a navigation or flow reference is rejected', (t) => {
  const report = fixture(t, ['', 'app/forgotten'], "const home = { href: '/' };");
  assert.deepEqual(report.uncovered, ['/app/forgotten']);
});

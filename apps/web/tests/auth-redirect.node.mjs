import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isNeonSignInRedirect } from '../scripts/auth-redirect.mjs';

const base = 'https://preview.example.test';
for (const location of ['/auth/sign-in', `${base}/auth/sign-in?next=%2Fapp`]) {
  test(`accepts the same-site sign-in destination: ${location}`, () => {
    assert.equal(isNeonSignInRedirect(location, base), true);
  });
}

for (const catalogAvailable of [true, false]) {
  test(`smoke rejects a ready database with an unavailable catalog: available=${catalogAvailable}`, async () => {
    const server = createServer((request, response) => {
      const path = request.url;
      if (path === '/api/health/live') {
        response.end('{}');
      } else if (path === '/api/health/ready') {
        response.end(
          JSON.stringify({
            status: 'ready',
            deploymentMode: 'controlled_pilot',
            db: { connected: true, schemaApplied: true },
            platform: { agencyCollaboration: 'available', bulkExport: 'available' },
          }),
        );
      } else if (['/app', '/app/privacy', '/callback'].includes(path)) {
        response.writeHead(307, { location: '/auth/sign-in' });
        response.end();
      } else if (path === '/trust') {
        response.end(
          `<html><h1>${catalogAvailable ? 'Maintained route information' : 'Unavailable'}</h1></html>`,
        );
      } else {
        response.end('<html><div class="pilot-banner">VisaStack private pilot</div></html>');
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const code = await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [fileURLToPath(new URL('../scripts/smoke.mjs', import.meta.url))],
          {
            env: {
              ...process.env,
              SMOKE_BASE_URL: `http://127.0.0.1:${address.port}`,
              NODE_USE_ENV_PROXY: '0',
            },
            stdio: 'ignore',
          },
        );
        child.on('error', reject);
        child.on('exit', resolve);
      });
      assert.equal(code, catalogAvailable ? 0 : 1);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
for (const location of [
  '/app',
  '/app/privacy',
  '/',
  '/auth/sign-in/other',
  'https://other.example.test/auth/sign-in',
  '//other.example.test/auth/sign-in',
  'https://preview.example.test.attacker.test/auth/sign-in',
  'http://preview.example.test/auth/sign-in',
  'https://preview.example.test:8443/auth/sign-in',
  'https://user:password@preview.example.test/auth/sign-in',
  'https://api.workos.com/auth/sign-in',
  'javascript:alert(1)',
]) {
  test(`rejects a leaked or different sign-in destination: ${location}`, () => {
    assert.equal(isNeonSignInRedirect(location, base), false);
  });
}

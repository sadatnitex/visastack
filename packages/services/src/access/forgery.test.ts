import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  SYSTEM_JOBS,
  SelfScope,
  SystemScope,
  selfPrincipal,
  selfScopeProblem,
  systemPrincipal,
} from './principal';

const here = path.dirname(fileURLToPath(import.meta.url));
const servicesDir = path.resolve(here, '../..');
const jobsDir = path.resolve(servicesDir, '../../apps/web/src/app/api/jobs');

describe('gate values cannot be forged', () => {
  it('every forgery in forgery.test-d.ts fails to type-check', () => {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      path.join(servicesDir, 'tsconfig.json'),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
          throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
        },
      },
    );
    if (!parsed) throw new Error('could not read packages/services/tsconfig.json');
    const fixture = path.join(here, 'forgery.test-d.ts');
    const program = ts.createProgram({
      rootNames: [fixture],
      options: { ...parsed.options, noEmit: true },
    });
    const sf = program.getSourceFile(fixture);
    if (!sf) throw new Error('fixture not in program');
    const diagnostics = [
      ...program.getSyntacticDiagnostics(sf),
      ...program.getSemanticDiagnostics(sf),
    ].map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    // An unused @ts-expect-error (a forgery that now compiles) is reported here.
    expect(diagnostics).toEqual([]);
    const expectations = sf.text.match(/@ts-expect-error/g) ?? [];
    expect(expectations.length).toBeGreaterThanOrEqual(7);
  }, 120_000);

  it('rejects spread copies and direct construction of a SystemScope at run time', () => {
    const scope = systemPrincipal('process-erasure');
    expect(SystemScope.isGenuine(scope)).toBe(true);
    expect(SystemScope.isGenuine({ ...scope })).toBe(false);
    expect(Object.isFrozen(scope)).toBe(true);
    const Ctor = SystemScope as unknown as new (job: string) => unknown;
    expect(() => new Ctor('process-erasure')).toThrow(/systemPrincipal/);
  });

  it('rejects spread copies, direct construction and stale copies of a SelfScope (ADR 0025)', () => {
    const self = selfPrincipal('00000000-0000-4000-8000-000000000001');
    expect(SelfScope.isGenuine(self)).toBe(true);
    expect(selfScopeProblem(self)).toBeUndefined();
    expect(Object.isFrozen(self)).toBe(true);
    const copy = { ...self };
    expect(SelfScope.isGenuine(copy)).toBe(false);
    expect(selfScopeProblem(copy)?.code).toBe('forbidden');
    expect(selfScopeProblem({ kind: 'self', accountId: 'x', verifiedAt: new Date() })?.code).toBe(
      'forbidden',
    );
    const Ctor = SelfScope as unknown as new (id: string, at: Date) => unknown;
    expect(() => new Ctor('x', new Date())).toThrow(/selfPrincipal/);
    expect(() => selfPrincipal('')).toThrow(/signed-in account/);
    // Minted for one request: an old one is refused.
    const real = Date.now;
    try {
      Date.now = () => real() + 6 * 60 * 1000;
      expect(selfScopeProblem(self)?.code).toBe('forbidden');
    } finally {
      Date.now = real;
    }
  });

  it('SYSTEM_JOBS matches the job routes in apps/web/src/app/api/jobs', () => {
    const folders = readdirSync(jobsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect([...SYSTEM_JOBS].sort()).toEqual(folders);
  });
});

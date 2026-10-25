import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SYSTEM_JOBS, SystemScope, systemPrincipal } from './principal';

const here = path.dirname(fileURLToPath(import.meta.url));
const servicesDir = path.resolve(here, '../..');
const jobsDir = path.resolve(servicesDir, '../../apps/web/src/app/api/jobs');

describe('gate values cannot be forged', () => {
  it(
    'every forgery in forgery.test-d.ts fails to type-check',
    () => {
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
    },
    120_000,
  );

  it('rejects spread copies and direct construction of a SystemScope at run time', () => {
    const scope = systemPrincipal('process-erasure');
    expect(SystemScope.isGenuine(scope)).toBe(true);
    expect(SystemScope.isGenuine({ ...scope })).toBe(false);
    expect(Object.isFrozen(scope)).toBe(true);
    const Ctor = SystemScope as unknown as new (job: string) => unknown;
    expect(() => new Ctor('process-erasure')).toThrow(/systemPrincipal/);
  });

  it('SYSTEM_JOBS matches the job routes in apps/web/src/app/api/jobs', () => {
    const folders = readdirSync(jobsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect([...SYSTEM_JOBS].sort()).toEqual(folders);
  });
});

import { describe, expect, it } from 'vitest';
import { redactErrorMessage, serverErrorEvent } from './error-report';
import type { ObservabilityEvent } from './ports';

/** The metadata fields these tests read, typed so property access satisfies both TS and Biome. */
function meta(event: ObservabilityEvent) {
  return (event.metadata ?? {}) as {
    message?: string;
    callSites?: string;
    subject?: string;
  };
}

/** The shape the ORM gives a failed query: the SQL, then the bound values. */
function failedQuery(params: string, code = '42P01'): Error {
  const error = new Error(
    `Failed query: select "id" from "accounts" where "email" = $1\nparams: ${params}`,
  );
  (error as Error & { cause?: unknown }).cause = Object.assign(
    new Error('relation "accounts" does not exist'),
    { code, severity: 'ERROR' },
  );
  return error;
}

describe('serverErrorEvent', () => {
  it('keeps what diagnoses the failure: the statement, the database code and the call sites', () => {
    const event = serverErrorEvent('withSession', failedQuery('x'));
    expect(event.name).toBe('server_error');
    expect(event.severity).toBe('error');
    expect(event.metadata).toMatchObject({
      where: 'withSession',
      errorName: 'Error',
      databaseCode: '42P01',
      message: 'Failed query: select "id" from "accounts" where "email" = $1',
    });
    expect(String(meta(event).callSites)).toContain('error-report.test.ts');
  });

  it('drops the bound parameter values, which are whatever the request was handling', () => {
    const event = serverErrorEvent(
      'withSession',
      failedQuery('jane.doe@example.com, A1234567, Jane Doe'),
    );
    const written = JSON.stringify(event);
    for (const leaked of ['jane.doe', 'example.com', 'A1234567', 'Jane Doe']) {
      expect(written, leaked).not.toContain(leaked);
    }
  });

  it('removes an address that appears in the message itself, as some drivers put it there', () => {
    const event = serverErrorEvent(
      'api',
      new Error('duplicate key for "someone@example.org" violates unique constraint'),
    );
    expect(JSON.stringify(event)).not.toContain('someone@example.org');
    expect(meta(event).message).toBe('duplicate key for "[email]" violates unique constraint');
  });

  it('does not repeat the message through the stack, whose first line is the message', () => {
    const error = failedQuery('private@example.com');
    error.stack = `Error: ${error.message}\n    at one (/app/a.js:1:1)\n    at two (/app/b.js:2:2)`;
    const written = JSON.stringify(serverErrorEvent('x', error));
    expect(written).not.toContain('private@example.com');
    expect(written).toContain('at one (/app/a.js:1:1) | at two (/app/b.js:2:2)');
  });

  it('bounds the length of what it writes and the number of frames', () => {
    const error = new Error('x'.repeat(5_000));
    error.stack = `Error: x\n${Array.from({ length: 30 }, (_, i) => `    at f${i} (/a.js:${i}:1)`).join('\n')}`;
    const event = serverErrorEvent('x', error);
    expect(String(meta(event).message).length).toBe(400);
    expect(String(meta(event).callSites).split(' | ')).toHaveLength(5);
  });

  it('handles a thrown value that is not an Error', () => {
    const event = serverErrorEvent('x', 'plain string with a@b.co');
    expect(event.metadata).toMatchObject({
      errorName: 'string',
      message: 'plain string with [email]',
    });
  });

  it('carries extra context the caller supplies, such as an already-hashed subject reference', () => {
    const event = serverErrorEvent('withSession', new Error('x'), { subject: 'acct:abc123' });
    expect(meta(event).subject).toBe('acct:abc123');
  });
});

describe('redactErrorMessage', () => {
  it('cuts at the parameters whether the line break is LF or CRLF', () => {
    expect(redactErrorMessage('Failed query: select 1\r\nparams: secret')).toBe(
      'Failed query: select 1',
    );
    expect(redactErrorMessage('Failed query: select 1\nparams: secret')).toBe(
      'Failed query: select 1',
    );
  });
});

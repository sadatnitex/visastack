import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportRenderFailure, reportServerError } from './server-error';

describe('reportServerError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes one parseable server_error line and none of the query values the error carried', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = Object.assign(
      new Error(
        'Failed query: select * from "accounts" where "email" = $1\nparams: jane.doe@example.com',
      ),
      { cause: Object.assign(new Error('boom'), { code: '57P01' }) },
    );

    reportServerError('triggerNotificationWorker', failure, { step: 'worker pass failed' });

    expect(errorLog).toHaveBeenCalledTimes(1);
    const written = String(errorLog.mock.calls[0]?.[0]);
    expect(written).not.toContain('jane.doe');
    expect(written).not.toContain('example.com');
    const line = JSON.parse(written);
    expect(line).toMatchObject({
      name: 'server_error',
      severity: 'error',
      metadata: {
        where: 'triggerNotificationWorker',
        step: 'worker pass failed',
        databaseCode: '57P01',
      },
    });
  });
});

describe('reportRenderFailure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function written(contentType: string): string {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    reportRenderFailure(contentType);
    return String(warn.mock.calls[0]?.[0]);
  }

  it('records the content type and nothing else', () => {
    expect(JSON.parse(written('application/pdf'))).toMatchObject({
      name: 'render_failure',
      severity: 'warning',
      metadata: { contentType: 'application/pdf' },
    });
  });

  it('drops parameters, which can carry a file name', () => {
    const line = written('application/pdf; name="jane-doe-passport.pdf"');
    expect(line).not.toContain('jane-doe');
    expect(JSON.parse(line).metadata.contentType).toBe('application/pdf');
  });

  it('says unknown rather than echo a value that is not a content type', () => {
    const line = written('Jane Doe passport');
    expect(line).not.toContain('Jane');
    expect(JSON.parse(line).metadata.contentType).toBe('unknown');
  });
});

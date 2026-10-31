import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FormMessage, NO_RESULT, SubmitButton, fieldProblem, isFailure } from './form-feedback';

const failure = { ok: false, message: 'Enter a value first.', field: 'value' };
const success = { ok: true, message: 'Saved.' };

describe('isFailure', () => {
  it('is true only for a failure that has something to say', () => {
    expect(isFailure(failure)).toBe(true);
    expect(isFailure(success)).toBe(false);
    expect(isFailure(NO_RESULT)).toBe(false);
    expect(isFailure({ ok: false, message: '' })).toBe(false);
  });
});

describe('fieldProblem', () => {
  it('ties the input the problem is about to the message', () => {
    expect(fieldProblem(failure, 'value', 'msg-1')).toEqual({
      'aria-invalid': true,
      'aria-describedby': 'msg-1',
    });
  });

  it('says nothing about an input the problem is not about', () => {
    expect(fieldProblem(failure, 'effectiveFrom', 'msg-1')).toEqual({});
  });

  it('says nothing when the form has no field to blame, or no failure', () => {
    expect(fieldProblem({ ok: false, message: 'Not authorized.' }, 'value', 'msg-1')).toEqual({});
    expect(fieldProblem(success, 'value', 'msg-1')).toEqual({});
    expect(fieldProblem(NO_RESULT, 'value', 'msg-1')).toEqual({});
  });
});

describe('FormMessage', () => {
  const render = (props: Parameters<typeof FormMessage>[0]) =>
    renderToStaticMarkup(<FormMessage {...props} />);

  it('is always in the page, with both regions present, before anything has happened', () => {
    const html = render({ id: 'm', result: NO_RESULT });
    // the id sits on the failure text, which is what an invalid input points to
    expect(html).toContain('<p id="m" role="alert" class="field-msg field-msg-err"></p>');
    expect(html).toContain('<output class="field-msg field-msg-ok"></output>');
  });

  it('announces a failure through the region that interrupts, and leaves the polite one empty', () => {
    const html = render({ result: failure });
    expect(html).toContain(
      '<p role="alert" class="field-msg field-msg-err">Enter a value first.</p>',
    );
    expect(html).toContain('<output class="field-msg field-msg-err"></output>');
  });

  it('says the upgrade line after a refusal’s own words, as a link to Plan & Usage (ADR 0025)', () => {
    const html = render({ result: { ok: false, message: 'Limit reached.', upgrade: 'ai' } });
    expect(html).toContain(
      '<p role="alert" class="field-msg field-msg-err">Limit reached. <a href="/app/account/plan">A paid plan gives you a higher daily limit. See Plan &amp; Usage.</a></p>',
    );
    expect(render({ result: { ok: false, message: 'Full.', upgrade: 'storage' } })).toContain(
      'Full. <a href="/app/account/plan">A paid plan gives you more room. See Plan &amp; Usage.</a>',
    );
    // Only ever with a refusal: never on success, and not while a new attempt is running.
    expect(render({ result: { ok: true, message: 'Saved.', upgrade: 'ai' } })).not.toContain(
      'paid plan',
    );
    expect(
      render({
        result: { ok: false, message: 'Full.', upgrade: 'storage' },
        pending: true,
        pendingText: 'Working.',
      }),
    ).not.toContain('paid plan');
    expect(render({ result: failure })).not.toContain('paid plan');
  });

  it('announces a success politely, in the success colour', () => {
    const html = render({ result: success });
    expect(html).toContain('<output class="field-msg field-msg-ok">Saved.</output>');
    expect(html).toContain('<p role="alert" class="field-msg field-msg-err"></p>');
  });

  it('says in words that an action is working, while it is', () => {
    const html = render({
      result: NO_RESULT,
      pending: true,
      pendingText: 'Uploading. This can take a minute.',
    });
    expect(html).toContain('<output class="field-msg">Uploading. This can take a minute.</output>');
    expect(html).toContain('<p role="alert" class="field-msg field-msg-err"></p>');
  });

  it('puts progress first even when an earlier result is still on screen', () => {
    const html = render({ result: failure, pending: true, pendingText: 'Working.' });
    expect(html).toContain('<output class="field-msg">Working.</output>');
    expect(html).toContain('<p role="alert" class="field-msg field-msg-err"></p>');
  });

  it('ignores pending when the form gave no words for it', () => {
    const html = render({ result: success, pending: true });
    expect(html).toContain('<output class="field-msg field-msg-ok">Saved.</output>');
  });
});

describe('SubmitButton', () => {
  const button = (
    pending: boolean,
  ): ReactElement<{
    'aria-disabled'?: boolean;
    disabled?: boolean;
    onClick: (event: { preventDefault: () => void }) => void;
    children: unknown;
  }> => SubmitButton({ pending, idle: 'Save', busy: 'Saving…' }) as never;

  it('says what it does, and is a real submit button', () => {
    const html = renderToStaticMarkup(<SubmitButton pending={false} idle="Save" busy="Saving…" />);
    expect(html).toBe('<button type="submit" class="btn btn-primary">Save</button>');
  });

  it('says it is working and tells assistive technology it is unavailable, without using disabled', () => {
    const html = renderToStaticMarkup(<SubmitButton pending idle="Save" busy="Saving…" />);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('>Saving…</button>');
    // A disabled button drops keyboard focus to the top of the page.
    expect(html).not.toContain('disabled=""');
  });

  it('refuses a click while an action is running, so it cannot be sent twice', () => {
    const preventDefault = vi.fn();
    button(true).props.onClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('lets a click through when nothing is running', () => {
    const preventDefault = vi.fn();
    button(false).props.onClick({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('passes the choice a pair of buttons makes (name and value), and a custom look', () => {
    const html = renderToStaticMarkup(
      <SubmitButton
        pending={false}
        idle="Reject"
        busy="Saving…"
        name="nameAction"
        value="reject"
        className="btn btn-secondary"
        style={{ padding: '0.3rem' }}
      />,
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain('name="nameAction"');
    expect(html).toContain('value="reject"');
    expect(html).toContain('class="btn btn-secondary"');
    expect(html).toContain('style="padding:0.3rem"');
    expect(html).toContain('>Reject</button>');
  });
});

import { describe, expect, it } from 'vitest';
import { axeViolations } from './axe.test-support';

/**
 * The accessibility scan is only worth its green result if it goes red on real
 * mistakes. These are the mistakes it exists to catch, fed to it on purpose.
 */

describe('the accessibility scan itself', () => {
  it('passes markup that is built correctly', async () => {
    expect(
      await axeViolations(
        '<form><label for="n">Name</label><input id="n" name="n"><button type="submit">Save</button></form>',
      ),
    ).toEqual([]);
  });

  it('catches a field with no name', async () => {
    const found = await axeViolations('<form><input name="n"></form>');
    expect(found.join('\n')).toContain('label');
  });

  it('does not count a placeholder as a name (axe does, so form-labels.test.ts polices it)', async () => {
    expect(await axeViolations('<form><input name="n" placeholder="Name"></form>')).toEqual([]);
  });

  it('catches a button with no name', async () => {
    const found = await axeViolations('<button type="button"><svg></svg></button>');
    expect(found.join('\n')).toContain('button-name');
  });

  it('catches a field marked as described by a message that is not in the page', async () => {
    const found = await axeViolations(
      '<label for="n">Name</label><input id="n" aria-invalid="true" aria-describedby="n-error">',
    );
    expect(found.join('\n')).toContain('dangling-reference');
    expect(found.join('\n')).toContain('n-error');
  });

  it('accepts a field described by a message that is in the page', async () => {
    expect(
      await axeViolations(
        '<label for="n">Name</label><input id="n" aria-invalid="true" aria-describedby="n-error"><p id="n-error" role="alert">Enter a name.</p>',
      ),
    ).toEqual([]);
  });

  it('catches one id used twice', async () => {
    const found = await axeViolations(
      '<label for="n">Name</label><input id="n"><label for="n">Other</label><input id="n">',
    );
    expect(found.join('\n')).toContain('duplicate-id');
  });

  it('catches a link to a place on the page that is not there', async () => {
    const found = await axeViolations('<a href="#nowhere">Skip to content</a><p>Words.</p>');
    expect(found.join('\n')).toContain('dangling-link');
    expect(await axeViolations('<a href="#here">Go</a><h2 id="here">Here</h2>')).toEqual([]);
  });

  it('catches an invalid ARIA role and a skipped heading level', async () => {
    const found = (await axeViolations('<div role="banana">x</div><h1>One</h1><h4>Four</h4>')).join(
      '\n',
    );
    expect(found).toContain('aria-roles');
    expect(found).toContain('heading-order');
  });

  it('does not ask a single component for the things only a whole page has', async () => {
    expect(await axeViolations('<p>Just a paragraph.</p>')).toEqual([]);
    const page = (await axeViolations('<p>Just a paragraph.</p>', { wholePage: true })).join('\n');
    expect(page).toContain('landmark-one-main');
    expect(page).toContain('page-has-heading-one');
  });

  it('accepts a whole page with one main landmark and one top heading', async () => {
    expect(
      await axeViolations('<main><h1>Title</h1><p>Words.</p></main>', { wholePage: true }),
    ).toEqual([]);
  });

  it('refuses a page with two main landmarks or two top headings', async () => {
    const found = (
      await axeViolations('<main><h1>One</h1></main><main><h1>Two</h1></main>', {
        wholePage: true,
      })
    ).join('\n');
    expect(found).toContain('landmark-one-main');
    expect(found).toContain('page-has-heading-one');
  });

  it('can be told a rule does not apply, and only that rule', async () => {
    const markup = '<button type="button"></button><div role="banana">x</div>';
    const found = (await axeViolations(markup, { skip: ['button-name'] })).join('\n');
    expect(found).not.toContain('button-name');
    expect(found).toContain('aria-roles');
  });
});

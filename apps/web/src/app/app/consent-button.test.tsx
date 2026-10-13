import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ setConsentAction: vi.fn() }));

const { ConsentButton } = await import('./consent-button');
const text = (html: string) => html.replace(/<[^>]*>/g, '|');

describe('ConsentButton', () => {
  it('says Turn on and Turn off in English and sends the same values as before', () => {
    const off = renderToStaticMarkup(
      <ConsentButton type="SHARING" granted={false} locale="en" label="Let me share with others" />,
    );
    expect(text(off)).toContain('Turn on');
    expect(off).toContain('name="granted" value="true"');
    expect(off).toContain('name="type" value="SHARING"');
    const on = renderToStaticMarkup(
      <ConsentButton type="SHARING" granted locale="en" label="Let me share with others" />,
    );
    expect(text(on)).toContain('Turn off');
    expect(on).toContain('name="granted" value="false"');
  });

  it('keeps the existing Bangla words until the Bangla work resumes', () => {
    const bn = renderToStaticMarkup(<ConsentButton type="SHARING" granted={false} locale="bn" />);
    expect(text(bn)).toContain('প্রদান করুন');
    expect(text(bn)).not.toContain('Turn on');
  });
});

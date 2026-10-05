import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Rich } from './rich';

describe('Rich', () => {
  it('puts emphasis and a link exactly where the message puts them', () => {
    const html = renderToStaticMarkup(
      <Rich
        template="Grant <b>Core processing</b> from <link>Overview</link>."
        locale="en"
        link={(text) => <a href="/app">{text}</a>}
      />,
    );
    expect(html).toBe('Grant <strong>Core processing</strong> from <a href="/app">Overview</a>.');
  });

  it('lets each language order the pieces its own way', () => {
    const html = renderToStaticMarkup(
      <Rich
        template="শুরু করতে <link>সারসংক্ষেপ</link> পাতা থেকে <b>মূল প্রক্রিয়াকরণে</b> সম্মতি দিন।"
        locale="bn"
        link={(text) => <a href="/app">{text}</a>}
      />,
    );
    expect(html).toContain('<a href="/app">সারসংক্ষেপ</a>');
    expect(html).toContain('<strong>মূল প্রক্রিয়াকরণে</strong>');
    expect(html.indexOf('সারসংক্ষেপ')).toBeLessThan(html.indexOf('মূল প্রক্রিয়াকরণে'));
  });

  it('fills values, writing numbers in the locale digits and text exactly as given', () => {
    const html = renderToStaticMarkup(
      <Rich template="<b>{name}</b> - {count}টি" locale="bn" params={{ name: 'রহিম', count: 3 }} />,
    );
    expect(html).toBe('<strong>রহিম</strong> - ৩টি');
  });

  it('shows a typed value that looks like a tag as plain, escaped text', () => {
    const html = renderToStaticMarkup(
      <Rich template="<b>{name}</b>" locale="en" params={{ name: '<b>x</b>' }} />,
    );
    expect(html).toBe('<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
  });

  it('shows link text as plain text when the caller gives no link', () => {
    expect(renderToStaticMarkup(<Rich template="a <link>b</link> c" locale="en" />)).toBe('a b c');
  });

  it('copes with the same piece appearing twice', () => {
    expect(renderToStaticMarkup(<Rich template="<b>x</b> and <b>x</b>" locale="en" />)).toBe(
      '<strong>x</strong> and <strong>x</strong>',
    );
  });
});

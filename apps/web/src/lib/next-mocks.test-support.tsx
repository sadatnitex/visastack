import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';

/**
 * Shared stand-ins for the Next.js pieces a page imports, so a server page can be
 * called as a function and rendered to static markup in a unit test (the same
 * technique as the public trust page's test). Import this FIRST in a test file:
 * the mocks it registers must exist before the page under test is loaded.
 */

const state = vi.hoisted(() => ({ pathname: '/', locale: 'en' }));

/** What `usePathname()` returns while a page renders; set it to see which tab is current. */
export const navigationState = state;

/** The visitor's language cookie while a page renders: set `localeState.value = 'bn'` to see it in Bangla. */
export const localeState = {
  get value(): string {
    return state.locale;
  },
  set value(next: string) {
    state.locale = next;
  },
};

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'visastack_locale' ? { value: state.locale } : undefined),
    set: () => undefined,
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  usePathname: () => state.pathname,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * A client component replaced by a marker that records its props. Lets a test
 * check that a page puts the right form in the right place with the right data
 * without loading the form (and the server actions behind it).
 */
export function stub(name: string) {
  return (props: Record<string, unknown>) => (
    <span data-stub={name} data-props={JSON.stringify(props)} />
  );
}

/**
 * The props a stub was given, parsed back out of the markup, one entry per occurrence.
 * Name the shape you expect (`stubProps<{ jobId: string }>(html, 'RetryJobButton')`).
 */
export function stubProps<T extends object = Record<string, unknown>>(
  html: string,
  name: string,
): T[] {
  const found: T[] = [];
  const pattern = new RegExp(`<span data-stub="${name}" data-props="([^"]*)"></span>`, 'g');
  for (const match of html.matchAll(pattern)) {
    const json = (match[1] ?? '')
      .replaceAll('&quot;', '"')
      .replaceAll('&#x27;', "'")
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>');
    found.push(JSON.parse(json) as T);
  }
  return found;
}

/** Renders what a (possibly async) server page or layout returns; `null` renders as nothing. */
export async function renderServer(
  element: Promise<ReactElement | null> | ReactElement | null,
): Promise<string> {
  const resolved = await element;
  return resolved === null ? '' : renderToStaticMarkup(resolved);
}

/**
 * The Latin-script words in some text. On a Bangla screen the only ones left should be what a
 * person typed (an email address, a name in English) and the brand, never interface wording.
 */
export function latinWords(text: string): string[] {
  return text.match(/[A-Za-z][A-Za-z0-9]*/g) ?? [];
}

/** Collapses markup to its words, for assertions that should not care about tags. */
export function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replace(/\s+/g, ' ')
    .trim();
}

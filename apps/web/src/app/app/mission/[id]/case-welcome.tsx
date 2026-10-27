'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The note a new case opens with (owner list item 1): it says the case exists and what to do
 * first, in words the server worked out from the case itself (whether a checklist is linked).
 *
 * Opening a new case puts the page at its top and keyboard focus on this note, so nobody lands
 * halfway down the page and a screen reader says at once that the case was created. The address
 * loses its `welcome` mark straight away, so reloading or sharing the link later shows the plain
 * case page; Got It puts the note away.
 */
export function CaseWelcome({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: readonly string[];
  readonly action: { readonly href: string; readonly label: string };
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
    heading.current?.focus({ preventScroll: true });
    const url = new URL(window.location.href);
    if (url.searchParams.has('welcome')) {
      url.searchParams.delete('welcome');
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }, []);

  if (!shown) return null;
  return (
    <section className="case-welcome" aria-labelledby="case-welcome-heading">
      <h2 className="case-welcome-title" id="case-welcome-heading" ref={heading} tabIndex={-1}>
        {title}
      </h2>
      {body.map((line) => (
        <p className="case-welcome-body" key={line}>
          {line}
        </p>
      ))}
      <div className="case-welcome-actions">
        <a className="btn btn-primary" href={action.href}>
          {action.label}
        </a>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setShown(false);
            // The note leaves the page, so focus goes to the case's own title rather than nowhere.
            const title = document.querySelector<HTMLElement>('.page-title');
            if (title) {
              title.tabIndex = -1;
              title.focus();
            }
          }}
        >
          Got It
        </button>
      </div>
    </section>
  );
}

import { CATALOGS } from '@visastack/i18n';

/**
 * Loading state for a signed-in screen (Commercial V1 Part 9 UX-02, "loading").
 * Next shows it while the page's own data is being read, so a slow connection
 * sees a stable page with a clear "Loading…" instead of a frozen one. It is a
 * `<output>`, whose built-in role is `status` (a polite live region), so a screen
 * reader hears that something is loading and nothing else until the real page
 * replaces it; the grey shapes are decoration and hidden from assistive
 * technology.
 *
 * The label is written in English and in Bangla and the stylesheet shows the one
 * that matches the page's language, so this stays a plain static component (a
 * loading screen must not wait on a lookup of who is reading).
 *
 * `frame="page"` supplies its own section padding for a screen that fills the
 * page. `frame="panel"` is for content that already sits inside a workspace
 * shell (an applicant's tabs), which supplies the padding itself.
 */
export function PageLoading({
  label = 'Loading',
  frame = 'page',
}: {
  readonly label?: string;
  readonly frame?: 'page' | 'panel';
}) {
  const body = (
    <output className="loading">
      <span className="muted loading-label" lang="en">
        {label}…
      </span>
      <span className="muted loading-label" lang="bn">
        {CATALOGS.bn['shell.loading']}
      </span>
      <span className="skeleton skeleton-title" aria-hidden="true" />
      <span className="skeleton skeleton-line" aria-hidden="true" />
      <span className="skeleton skeleton-card" aria-hidden="true" />
    </output>
  );
  return frame === 'page' ? <section className="section container">{body}</section> : body;
}

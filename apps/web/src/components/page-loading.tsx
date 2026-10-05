/**
 * Loading state for a signed-in screen (Commercial V1 Part 9 UX-02, "loading").
 * Next shows it while the page's own data is being read, so a slow connection
 * sees a stable page with a clear "Loading…" instead of a frozen one. It is a
 * `<output>`, whose built-in role is `status` (a polite live region), so a screen
 * reader hears that something is loading and nothing else until the real page
 * replaces it; the grey shapes are decoration and hidden from assistive
 * technology.
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
      <span className="muted loading-label">{label}…</span>
      <span className="skeleton skeleton-title" aria-hidden="true" />
      <span className="skeleton skeleton-line" aria-hidden="true" />
      <span className="skeleton skeleton-card" aria-hidden="true" />
    </output>
  );
  return frame === 'page' ? <section className="section container">{body}</section> : body;
}

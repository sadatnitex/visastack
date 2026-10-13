import { LoadingSlowNote } from './loading-slow-note';

/** The outline a loading screen draws, matched to the kind of page that is coming. */
export type LoadingShape = 'default' | 'list' | 'detail' | 'dashboard' | 'form';

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
 *
 * `shape` draws the outline of the page that is coming (a list, a case, a dashboard or a
 * form); the label says what is loading. After a few seconds a short note says it is still
 * loading. Presentation only: no page logic lives here.
 */
export function PageLoading({
  label = 'Loading',
  frame = 'page',
  shape = 'default',
}: {
  readonly label?: string;
  readonly frame?: 'page' | 'panel';
  readonly shape?: LoadingShape;
}) {
  const body = (
    <output className="loading">
      <span className="muted loading-label">{label}…</span>
      <LoadingSlowNote />
      <LoadingShapes shape={shape} />
    </output>
  );
  // A whole page has exactly one top heading even while it loads (WCAG 1.3.1); a panel sits under
  // the workspace heading that is already on screen.
  return frame === 'page' ? (
    <section className="section container">
      <h1 className="sr-only">{label}</h1>
      {body}
    </section>
  ) : (
    body
  );
}

function Shape({ kind }: { readonly kind: string }) {
  return <span className={`skeleton skeleton-${kind}`} aria-hidden="true" />;
}

function LoadingShapes({ shape }: { readonly shape: LoadingShape }) {
  switch (shape) {
    case 'list':
      return (
        <>
          <Shape kind="title" />
          <Shape kind="row" />
          <Shape kind="row" />
          <Shape kind="row" />
          <Shape kind="row" />
        </>
      );
    case 'detail':
      return (
        <>
          <Shape kind="title" />
          <span className="loading-tabs" aria-hidden="true">
            <Shape kind="tab" />
            <Shape kind="tab" />
            <Shape kind="tab" />
            <Shape kind="tab" />
          </span>
          <span className="loading-grid loading-grid-2" aria-hidden="true">
            <Shape kind="card" />
            <Shape kind="card" />
          </span>
        </>
      );
    case 'dashboard':
      return (
        <>
          <span className="loading-grid loading-grid-4" aria-hidden="true">
            <Shape kind="tile" />
            <Shape kind="tile" />
            <Shape kind="tile" />
            <Shape kind="tile" />
          </span>
          <Shape kind="card" />
          <Shape kind="card" />
        </>
      );
    case 'form':
      return (
        <>
          <span className="loading-tabs" aria-hidden="true">
            <Shape kind="tab" />
            <Shape kind="tab" />
            <Shape kind="tab" />
          </span>
          <Shape kind="field" />
          <Shape kind="field" />
          <Shape kind="field" />
        </>
      );
    default:
      return (
        <>
          <Shape kind="title" />
          <Shape kind="line" />
          <Shape kind="card" />
        </>
      );
  }
}

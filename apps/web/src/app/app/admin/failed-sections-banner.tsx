/**
 * Said plainly at the top of a platform page when part of it could not be read,
 * so a section shown empty or at zero is never mistaken for "nothing there". It
 * is most often a database migration that has not been applied yet.
 */
export function FailedSectionsBanner({ sections }: { readonly sections: readonly string[] }) {
  if (sections.length === 0) return null;
  return (
    <article
      className="card"
      role="alert"
      style={{ marginBottom: '1.5rem', borderColor: 'var(--danger, #b42318)' }}
    >
      <p className="card-kicker">Incomplete Page</p>
      <h2 className="card-title">Some sections could not be loaded</h2>
      <p className="card-body">
        {sections.join(', ')}. The sections on this page are shown empty or at zero because they
        could not be read, not because there is nothing there. This is most often a database
        migration that has not been applied yet; check the runtime log for the exact message.
      </p>
    </article>
  );
}

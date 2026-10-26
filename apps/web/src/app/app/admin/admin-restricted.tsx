/** What anyone who is not a platform administrator sees in place of a platform page. */
export function AdminRestricted() {
  return (
    <article className="card">
      <p className="card-body">
        This area is restricted to platform administrators. If you should have access, ask an
        existing platform owner to grant you a role.
      </p>
    </article>
  );
}

/** What a platform administrator sees on a page their own role does not cover. */
export function AdminNotForRole() {
  return (
    <article className="card">
      <p className="card-body">
        Not available for your role. Ask a platform owner if you need this view.
      </p>
    </article>
  );
}

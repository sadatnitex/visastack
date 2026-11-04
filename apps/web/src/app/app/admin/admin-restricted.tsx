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

/**
 * What a platform administrator sees on a page their own role does not cover. `needs` names who
 * can open it, in plain words ("a Support Admin or a platform owner").
 */
export function AdminNotForRole({ needs }: { readonly needs?: string }) {
  return (
    <article className="card">
      <p className="card-body">
        Not available for your role.{' '}
        {needs
          ? `This view is for ${needs}. Ask a platform owner if you need it.`
          : 'Ask a platform owner if you need this view.'}
      </p>
    </article>
  );
}

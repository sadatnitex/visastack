/**
 * Lets a page that gathers many independent figures keep rendering when one of
 * them cannot be read (for example a table that a pending database migration has
 * not created yet). The failure is logged and the section's label is recorded so
 * the page can say plainly that it is incomplete.
 *
 * Never use this for an authorization decision: those must fail closed, so a
 * failed check has to stay an error, not become `false`.
 */
export async function tolerate<T>(
  label: string,
  run: () => Promise<T>,
  fallback: T,
  failed: string[],
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    failed.push(label);
    // Message only: a driver error can carry query parameters.
    console.error(
      `[admin] section "${label}" could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fallback;
  }
}

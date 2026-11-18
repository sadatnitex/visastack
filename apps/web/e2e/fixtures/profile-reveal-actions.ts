/** Test-only stand-in for the profile reveal action (ESS1). Opens nothing; no network access. */
export async function revealProfileValueAction() {
  return { ok: false } as const;
}

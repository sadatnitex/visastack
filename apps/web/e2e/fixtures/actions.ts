/** Test-only action stand-ins. No network access or persistence. */
export async function saveFactAction() {
  return { ok: false, message: 'Test fixture: no data saved.' };
}
export async function createGrantAction() {
  return { ok: false, message: 'Test fixture: no access granted.' };
}

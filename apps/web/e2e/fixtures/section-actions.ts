/** Test-only stand-ins for the section actions. No network access or persistence. */
const refused = { ok: false, message: 'Test fixture: nothing was changed.' };
export async function setSectionOpenAction() {
  return refused;
}
export async function openSuggestedSectionsAction() {
  return refused;
}
export async function setExemptionAction() {
  return refused;
}
export async function saveOtherItemAction() {
  return refused;
}

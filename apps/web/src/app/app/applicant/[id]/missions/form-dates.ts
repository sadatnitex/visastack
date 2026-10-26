/** A date field from a case form: blank or unreadable means "not given". Shared by Start a Case and Prepare Again. */
export function parseOptionalDate(value: FormDataEntryValue | null): Date | undefined {
  const raw = String(value ?? '').trim();
  if (raw.length === 0) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

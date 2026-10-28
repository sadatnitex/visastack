/**
 * Whether a value from an address has the shape of a record id (a UUID). Checked before any
 * database work, so a malformed id is "not found" rather than a failed query.
 */
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRecordId(value: string): boolean {
  return RECORD_ID.test(value);
}

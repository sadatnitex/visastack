import { starterSheetCsv } from '@visastack/core';
import { currentStarterPacks } from '@visastack/services';
import { isPlatformAdmin } from '../../../../../../lib/admin';
import { withSession } from '../../../../../../lib/session';

/**
 * Downloads the starter checklists as they are now, in the same sheet shape the importer reads, so
 * an admin can edit them in a spreadsheet and load the sheet back. Platform admins only; read from
 * the stored lists, never from a file kept elsewhere.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const csv = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return null;
    return starterSheetCsv(await currentStarterPacks(db));
  });
  if (csv === null) return new Response('not authorized', { status: 403 });
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="starter-checklists.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}

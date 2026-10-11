import { getPlatformOverview } from '@visastack/services';
import { bootstrapAdminEmails } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';
/** Download only the same authorized aggregate metadata shown in the overview. */
export async function GET(): Promise<Response> {
  return withSession(async ({ db, accountId, email }) => {
    const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    let result: Awaited<ReturnType<typeof getPlatformOverview>>;
    try {
      result = await getPlatformOverview(db, {
        accountId,
        email,
        bootstrapEmails: bootstrapAdminEmails(),
      });
    } catch {
      return Response.json(
        { error: 'Report is unavailable. Try again later.' },
        { status: 503, headers },
      );
    }
    if (!result.ok)
      return Response.json({ error: 'Platform access is required.' }, { status: 403, headers });
    const overview = result.value;
    // Every CSV cell is a closed label, integer or generated ISO day, never user text.
    const lines = [
      'Metric,Count',
      `Registered accounts,${overview.accounts}`,
      `Traveller records,${overview.travellers}`,
      `Agency records,${overview.agencies}`,
      `Approved file versions,${overview.approvedVersions}`,
      `Terminal file versions,${overview.terminalVersions}`,
      '',
      'UTC day,First-case activations,Cases started',
      ...overview.activity.map((day) => `${day.day},${day.activated},${day.cases}`),
    ];
    return new Response(`${lines.join('\r\n')}\r\n`, {
      headers: {
        ...headers,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="visastack-platform-report.csv"',
      },
    });
  });
}

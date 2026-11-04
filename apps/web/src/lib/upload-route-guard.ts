import { unstable_rethrow } from 'next/navigation';

/** A short, safe description of a failure: its kind and code, never a file name or a value. */
export function describeUploadFailure(error: unknown): { name: string; code: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      name: error.name.slice(0, 60),
      code: typeof code === 'string' ? code.slice(0, 40) : '',
    };
  }
  return { name: typeof error, code: '' };
}

/**
 * Runs an upload route's work. A sign-in redirect or a not-found raised inside it passes through to
 * Next as it is. Anything else unexpected is written to the server log with its kind and the
 * step's name (never a file name, an id or a value) and answered with a plain JSON line, so a
 * failure before anything is stored leaves a reason to read instead of a bare server error page.
 * The browser still treats a server error as "not confirmed" and offers Try Again.
 */
export async function guardUploadRoute(
  route: string,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    const { name, code } = describeUploadFailure(error);
    console.error(`upload route failed route=${route} error=${name} code=${code || '-'}`);
    return Response.json(
      { message: 'We could not add this file just now. Try again in a minute.' },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      },
    );
  }
}

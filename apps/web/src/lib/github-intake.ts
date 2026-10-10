import 'server-only';

/** Dispatch only trusted main code; document bytes and URLs never enter the event. */
export async function dispatchGithubIntake(): Promise<void> {
  const deployment = 'VERCEL_ENV';
  if (process.env[deployment] !== 'production')
    throw new Error('Production document worker cannot be dispatched from this deployment');
  const name = 'GITHUB_INTAKE_DISPATCH_TOKEN';
  const token = process.env[name];
  if (!token) throw new Error('Private document worker is not configured');
  const response = await fetch(
    'https://api.github.com/repos/sadatnitex/visastack/actions/workflows/document-intake.yml/dispatches',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
      cache: 'no-store',
    },
  );
  if (response.status !== 204) throw new Error('Private document worker could not be queued');
}

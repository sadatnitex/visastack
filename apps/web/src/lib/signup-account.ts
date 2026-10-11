import 'server-only';
import { neon } from '@neondatabase/serverless';
import { resolveDatabaseUrl } from '@visastack/db';

/** Read only the managed auth database on the same endpoint as this deployment. */
export async function signupAccountExists(email: string): Promise<boolean> {
  const connection = resolveDatabaseUrl(process.env);
  const authVariable = 'NEON_AUTH_BASE_URL';
  const authBase = process.env[authVariable];
  if (!connection || !authBase) throw new Error('Signup account lookup unavailable');
  const database = new URL(connection);
  const auth = new URL(authBase);
  const endpoint = database.hostname.split('.')[0]?.replace(/-pooler$/, '');
  const authEndpoint = auth.hostname.split('.')[0];
  const authDatabase = auth.pathname.split('/')[1];
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !database.hostname.endsWith('.neon.tech') ||
    auth.protocol !== 'https:' ||
    !auth.hostname.includes('.neonauth.') ||
    !auth.hostname.endsWith('.neon.tech') ||
    !endpoint?.startsWith('ep-') ||
    endpoint !== authEndpoint ||
    !authDatabase ||
    !/^[a-zA-Z0-9_]+$/.test(authDatabase)
  ) {
    throw new Error('Signup account lookup unavailable');
  }
  database.pathname = `/${authDatabase}`;
  const query = neon(database.toString());
  const rows = await query`
    SELECT EXISTS (
      SELECT 1 FROM neon_auth."user" WHERE lower(email) = lower(${email})
    ) AS registered
  `;
  const resultField = 'registered';
  const registered = rows[0]?.[resultField];
  if (typeof registered !== 'boolean') {
    throw new Error('Signup account lookup unavailable');
  }
  return registered;
}

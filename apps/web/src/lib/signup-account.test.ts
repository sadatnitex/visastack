import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
const neon = vi.fn((_url: string) => query);
vi.mock('@neondatabase/serverless', () => ({ neon: (url: string) => neon(url) }));
const resolveDatabaseUrl = vi.fn();
vi.mock('@visastack/db', () => ({ resolveDatabaseUrl: () => resolveDatabaseUrl() }));

beforeEach(() => {
  vi.clearAllMocks();
  // No credentials and no network calls: the query function is mocked above.
  resolveDatabaseUrl.mockReturnValue('postgresql://ep-example-pooler.us-east-1.aws.neon.tech/app');
  vi.stubEnv(
    'NEON_AUTH_BASE_URL',
    'https://ep-example.neonauth.us-east-1.aws.neon.tech/neondb/auth',
  );
  query.mockResolvedValue([{ registered: true }]);
});

describe('signup account lookup', () => {
  it('reads the matching auth database with a parameterized, read-only query', async () => {
    const { signupAccountExists } = await import('./signup-account');
    expect(await signupAccountExists("test'+@example.invalid")).toBe(true);
    expect(new URL(neon.mock.calls[0]?.[0] ?? '').pathname).toBe('/neondb');
    const [parts, email] = query.mock.calls[0] ?? [];
    expect(parts.join('')).toContain('SELECT EXISTS');
    expect(email).toBe("test'+@example.invalid");
    expect(parts.join('')).not.toContain(email);
    query.mockResolvedValue([{ registered: false }]);
    expect(await signupAccountExists('test@example.invalid')).toBe(false);
  });

  it.each([
    'https://ep-other.neonauth.us-east-1.aws.neon.tech/neondb/auth',
    'https://ep-example.neonauth.example.invalid/neondb/auth',
    'http://ep-example.neonauth.us-east-1.aws.neon.tech/neondb/auth',
    'https://ep-example.neonauth.us-east-1.aws.neon.tech/invalid-db/auth',
  ])('refuses a mismatched or unsupported auth endpoint', async (auth) => {
    vi.stubEnv('NEON_AUTH_BASE_URL', auth);
    const { signupAccountExists } = await import('./signup-account');
    await expect(signupAccountExists('test@example.invalid')).rejects.toThrow('unavailable');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects unavailable or malformed query results instead of guessing', async () => {
    const { signupAccountExists } = await import('./signup-account');
    query.mockResolvedValue([]);
    await expect(signupAccountExists('test@example.invalid')).rejects.toThrow('unavailable');
    query.mockRejectedValue(new Error('unavailable'));
    await expect(signupAccountExists('test@example.invalid')).rejects.toThrow('unavailable');
  });
});

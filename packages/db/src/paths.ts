import { fileURLToPath } from 'node:url';

/** The shipped migrations, the one place their location is written down. */
export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

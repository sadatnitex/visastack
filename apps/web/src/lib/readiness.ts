import 'server-only';
import { probeR2Storage } from '@visastack/adapters';
import {
  DATABASE_URL_ENV_CANDIDATES,
  type MigrationStatus,
  checkConnection,
  createNeonDb,
  getMigrationStatus,
  isSchemaApplied,
  resolveDatabaseUrl,
} from '@visastack/db';
import type { Db } from '@visastack/services';
import { type getPlatformCapabilities, resolvePlatformCapabilities } from './capabilities';
import { evaluateCommercialReadiness, evaluateOperationalReadiness } from './commercial-readiness';
import { getDeploymentMode } from './deployment-mode';
import { NEON_AUTH_ENV_VARS, isPresent, isSignInConfigured, readEnv } from './env';
import { runKmsSelfTest } from './kms-self-test';
import { SHIPPED_MIGRATIONS } from './migration-journal';
import { validateProviderEnv } from './providers';
import { type ReadinessSignals, readReadinessSignals } from './readiness-signals';

/**
 * Everything the platform knows about whether it can serve: configuration, the
 * database, the migrations, the providers and the commercial gates.
 *
 * This is the DETAILED view. It names missing configuration and pending
 * migrations, so it is for platform administrators only (the admin page). The
 * public probe (`/api/health/ready`) decides what to reveal from it and, on any
 * deployed build, reveals only the coarse verdict (OPS-03: public health is
 * coarse, admin readiness is detailed, secret presence is never public).
 */

function presenceMap(names: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(names.map((name) => [name, isPresent(name)]));
}

export type MigrationReadiness =
  | ({ readonly checked: true } & MigrationStatus)
  | { readonly checked: false };

export interface ReadinessReport {
  readonly ready: boolean;
  readonly status: 'ready' | 'degraded';
  readonly deploymentMode: ReturnType<typeof getDeploymentMode>;
  readonly env: {
    readonly database: Record<string, boolean>;
    readonly signIn: Record<string, boolean>;
  };
  readonly db: { connected: boolean; schemaApplied: boolean; error?: string };
  readonly migrations: MigrationReadiness;
  readonly providers: { valid: boolean; error?: string };
  readonly capabilities: {
    readonly signedBlobStorage: boolean;
    readonly asyncIntakeSweep: boolean;
  };
  readonly platform: ReturnType<typeof getPlatformCapabilities>;
  readonly operational: ReturnType<typeof evaluateOperationalReadiness>;
  readonly commercial: ReturnType<typeof evaluateCommercialReadiness> | undefined;
}

export async function evaluateReadiness(): Promise<ReadinessReport> {
  const deploymentMode = getDeploymentMode();
  // The key service check runs alongside the database and storage probes, not after them.
  const keyServiceCheck =
    deploymentMode === 'commercial' || readEnv('KMS_PROVIDER') === 'aws_kms'
      ? runKmsSelfTest()
      : undefined;

  const env = {
    database: presenceMap(DATABASE_URL_ENV_CANDIDATES),
    signIn: presenceMap(NEON_AUTH_ENV_VARS),
  };

  let db: ReadinessReport['db'] = { connected: false, schemaApplied: false };
  let migrations: MigrationReadiness = { checked: false };
  // The connected, migrated database, handed to the live capability lookups
  // (AI settings live there); left unset whenever the database is not usable.
  let liveDb: Db | undefined;
  let signalsRead: Promise<ReadinessSignals> | undefined;

  const connectionString = resolveDatabaseUrl(process.env);
  if (connectionString) {
    try {
      const client = createNeonDb(connectionString);
      await checkConnection(client);
      db = { connected: true, schemaApplied: await isSchemaApplied(client) };
      if (db.schemaApplied) {
        liveDb = client as unknown as Db;
        // The AI provider settings and the scan runner's proof, read alongside the checks below.
        signalsRead = readReadinessSignals(liveDb);
      }
      try {
        migrations = {
          checked: true,
          ...(await getMigrationStatus(client, SHIPPED_MIGRATIONS)),
        };
      } catch {
        // The connection works; only the drift check failed. Say it was not
        // checked rather than guess in either direction.
        migrations = { checked: false };
      }
    } catch {
      db = { connected: false, schemaApplied: false, error: 'connection_failed' };
    }
  }

  // Finding #36: fail loudly the moment any *_PROVIDER var names a value this
  // deployment does not implement.
  let providers: ReadinessReport['providers'] = { valid: true };
  try {
    validateProviderEnv();
    const variable = 'STORAGE_PROVIDER';
    if (process.env[variable] === 'r2') {
      const config = (name: string) => process.env[name] ?? '';
      await probeR2Storage({
        endpoint: config('R2_ENDPOINT_URL'),
        accessKeyId: config('R2_ACCESS_KEY_ID'),
        secretAccessKey: config('R2_SECRET_ACCESS_KEY'),
      });
    }
  } catch (error) {
    providers = {
      valid: false,
      error: error instanceof Error ? error.message : 'invalid_provider_configuration',
    };
  }

  // A database whose migrations lag the code is not ready: pages that read the
  // newer tables fail, which is how production broke when 0078 to 0082 were
  // never applied while this probe still reported ready.
  const migrationsCurrent = !migrations.checked || migrations.pending.length === 0;
  const coreReady =
    db.connected &&
    db.schemaApplied &&
    migrationsCurrent &&
    isSignInConfigured() &&
    providers.valid;

  // The synchronous gates read both answers, so they must have arrived before the gates run.
  // The database facts go to both guards directly and are also remembered for the synchronous
  // capability checks (readiness-signals.ts); with no usable database they are unknown.
  const [, signals] = await Promise.all([
    keyServiceCheck,
    signalsRead ?? readReadinessSignals(undefined),
  ]);
  const commercial =
    deploymentMode === 'commercial'
      ? evaluateCommercialReadiness({ databaseReady: db.connected && db.schemaApplied, signals })
      : undefined;

  const operational = evaluateOperationalReadiness({ databaseReady: coreReady, signals });
  const platform = {
    ...(await resolvePlatformCapabilities(liveDb, {
      scannerEvidenceFresh: signals.scannerEvidenceFresh,
    })),
    ...(!operational.ready ? { realApplicantData: 'disabled' as const } : {}),
  };

  const ready = coreReady && (commercial?.ready ?? true);

  return {
    ready,
    status: ready ? 'ready' : 'degraded',
    deploymentMode,
    env,
    db,
    migrations,
    providers,
    capabilities: {
      signedBlobStorage: isPresent('BLOB_SIGNING_SECRET'),
      asyncIntakeSweep: isPresent('CRON_SECRET'),
    },
    platform,
    operational,
    commercial,
  };
}

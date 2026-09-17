-- Least-privilege application runtime role (Commercial V1 SEC-01):
-- visastack_app gets exactly the DML the running app needs -- no
-- CREATE/ALTER/DROP. neondb_owner (or another owner-privileged role) stays
-- the sole role that runs migrations.
--
-- ALTER DEFAULT PRIVILEGES applies going forward: a table or sequence a
-- future migration adds under neondb_owner is covered automatically,
-- without its own grant statement here.
--
-- Guarded on the role already existing (created directly in Neon's
-- console, outside this migration) rather than assumed: a fresh database
-- replaying the full migration history from scratch -- every PGlite test
-- run, a new Neon branch/project, a disaster-recovery restore -- has no
-- visastack_app role yet, and this migration must be a safe no-op there,
-- not a hard failure. drizzle's migrator tracks "already applied" purely
-- by migration timestamp, never by re-hashing content, so editing this
-- file after it already ran against production is safe: production is
-- already past this migration's timestamp and will never replay it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'visastack_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO visastack_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO visastack_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO visastack_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO visastack_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO visastack_app';
  END IF;
END $$;

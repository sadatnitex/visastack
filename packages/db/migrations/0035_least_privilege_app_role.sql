-- Least-privilege application runtime role (Commercial V1 SEC-01):
-- visastack_app gets exactly the DML the running app needs -- no
-- CREATE/ALTER/DROP. neondb_owner (or another owner-privileged role) stays
-- the sole role that runs migrations. This role must already exist
-- (created directly in Neon's console) before this migration runs.
--
-- ALTER DEFAULT PRIVILEGES applies going forward: a table or sequence a
-- future migration adds under neondb_owner is covered automatically,
-- without its own grant statement here.
GRANT USAGE ON SCHEMA public TO visastack_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO visastack_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO visastack_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO visastack_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO visastack_app;

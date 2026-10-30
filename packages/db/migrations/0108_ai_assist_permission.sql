-- Agency AI connectors (S22, ADR 0021 S22 amendment), first of two steps: the new sharing
-- permission AI_ASSIST ("Let This Agency Use AI Tools on What I Share"). Only this statement:
-- Postgres cannot use a new enum value in the transaction that adds it, so the tables that follow
-- come in the next migration. Re-runnable. No existing grant gains the permission; it is off on
-- every grant until the traveller turns it on for one agency.
ALTER TYPE "public"."permission_action" ADD VALUE IF NOT EXISTS 'AI_ASSIST';

import { type SQL, sql } from 'drizzle-orm';

/*
 * The lifecycle rule as SQL conditions, one place for every read (PROGRAMME section 3.2).
 *
 * Each condition is written against the unaliased `documents` or `applicants` table of the query
 * it is added to, so it fits any `select ... from documents` (or a join on it) as it stands. A
 * query that renames the table with an alias fails loudly ("missing FROM-clause entry"), never
 * silently. The lifecycle tables are named as text: building a condition reads nothing, so it
 * needs no access proof (the read it is added to carries its own).
 *
 * The conditions name tables that exist only after migration 0113. Add one only when
 * `lifecycleTablesPresent(db)` is true; while it is false nothing can be archived or deleted, so
 * leaving the condition out is exactly today's behaviour:
 *
 *   const lifecycle = await lifecycleTablesPresent(db);
 *   ...where(and(eq(schema.documents.applicantId, id), lifecycle ? everydayDocumentCondition() : undefined))
 */

/** Not in Recently Deleted and not being removed. For anything that must never show a deleted document. */
export function presentDocumentCondition(): SQL {
  return sql`not exists (select 1 from "document_lifecycle" as "lc_present_document" where "lc_present_document"."document_id" = "documents"."id" and "lc_present_document"."deleted_at" is not null)`;
}

/** Present and not archived. For default lists, offers and automatic matching. */
export function everydayDocumentCondition(): SQL {
  return sql`not exists (select 1 from "document_lifecycle" as "lc_everyday_document" where "lc_everyday_document"."document_id" = "documents"."id" and ("lc_everyday_document"."deleted_at" is not null or "lc_everyday_document"."archived_at" is not null))`;
}

/** The same rule for traveller records: not in Recently Deleted and not being removed. */
export function presentApplicantCondition(): SQL {
  return sql`not exists (select 1 from "applicant_lifecycle" as "lc_present_applicant" where "lc_present_applicant"."applicant_id" = "applicants"."id" and "lc_present_applicant"."deleted_at" is not null)`;
}

/** A present traveller record that is not archived. */
export function everydayApplicantCondition(): SQL {
  return sql`not exists (select 1 from "applicant_lifecycle" as "lc_everyday_applicant" where "lc_everyday_applicant"."applicant_id" = "applicants"."id" and ("lc_everyday_applicant"."deleted_at" is not null or "lc_everyday_applicant"."archived_at" is not null))`;
}

# Personal data may have been exposed

Use this when personal data or documents may have reached someone who should not have them: a
taken-over account, a leaked credential that was used, a share to the wrong person, a provider
reporting an incident, a file served to the wrong requester, a misdirected email, a lost device
holding an export. Read [README.md](./README.md) first. This page is about finding out what was
exposed and telling the right people, with the legal reviewer in charge of what is said.

Treat this as SEV1 from the first credible sign, and lower it only when the evidence supports it.

## What the product records that helps you

- The audit trail (`audit_events`) records document opens and previews (`DOCUMENT_ACCESS`, with
  `ALLOWED` or `DENIED`, the actor, the applicant, the document id and the purpose), shares
  (`GRANT_CREATED`, `GRANT_ACCEPTED`, `GRANT_REVOKED`, `GRANT_SCOPE_EXPANDED`), exports
  (`BULK_EXPORT`, `ACCOUNT_EXPORTED`), support access (`SUPPORT_GRANT_CREATED`), membership and
  role changes, and AI runs (`AI_*_RUN` with document and applicant).
- Every document read goes through a short-lived signed link that re-checks permission when it is
  opened, and previews are the rendered redacted copy, never the stored original.
- Protected profile fields (passport number, income and similar) are stored encrypted. Document
  bytes in the blob store are protected by the provider's access control, not by a second layer of
  our own encryption.
- Email notices carry neutral text and a link, never the sensitive record itself.

What it does **not** record, as far as the code shows: who looked at an ordinary profile page that is
not a document (the profile service audits edits and approvals, not reads), what a person copied or screenshotted after opening something,
and anything a provider did on its side. State those limits in the assessment.

## Contain

1. Declare, open the log, and tell the primary incident owner and the legal reviewer now. Do not wait
   until you know more.
2. Stop the exposure: end the sessions, revoke the shares, rotate the keys, switch off the feature
   (see [access-compromise.md](./access-compromise.md) and [secret-compromise.md](./secret-compromise.md)).
   Revoke rather than delete.
3. Do not contact the people affected, the recipient of a misdirected message, or anyone outside, until
   the legal reviewer has approved the words (README).
4. If a provider says the incident is theirs, get their written account and their contact, and ask
   what data of ours they hold and for how long.

## Preserve evidence

Follow the README before anything is cleaned up, including the evidence branch and the exports with
SHA-256 values. Keep the evidence to what you need; it contains personal data too.

## Assess: what, whose, when, how far

Run against the evidence branch only. Replace the placeholders.

```sql
-- Who opened or previewed which documents of one applicant, and whether it was allowed.
select occurred_at, actor_account_id, actor_role, result, resource_id, reason, ip
from audit_events
where applicant_id = '<applicant uuid>'
  and event_type = 'DOCUMENT_ACCESS'
  and occurred_at >= '<start>'
order by seq;

-- Everything that touched one applicant in the window, by kind of event.
select event_type, result, count(*)
from audit_events
where applicant_id = '<applicant uuid>' and occurred_at >= '<start>'
group by event_type, result
order by count(*) desc;

-- Shares that reached someone outside the person's own account in the window.
select occurred_at, event_type, actor_account_id, grant_id, applicant_id, reason
from audit_events
where event_type in ('GRANT_CREATED', 'GRANT_ACCEPTED', 'GRANT_SCOPE_EXPANDED', 'GRANT_REVOKED')
  and occurred_at >= '<start>'
order by seq;

-- Exports: a downloaded export cannot be recalled.
select occurred_at, event_type, actor_account_id, applicant_id, reason
from audit_events
where event_type in ('BULK_EXPORT', 'ACCOUNT_EXPORTED') and occurred_at >= '<start>'
order by seq;

-- Everyone who has (or had) an active share on an applicant now.
select id, status, recipient_account_id, recipient_organization_id, mission_id,
       purpose, start_at, expiry_at, created_at
from grants
where applicant_id = '<applicant uuid>'
order by created_at desc;
```

Write down, as plainly as you can:

1. **What kind of data:** documents, protected fields (and whether the key could have been exposed
   too), ordinary profile fields, email addresses, case notes.
2. **Whose and how many:** list the applicant ids. Do not copy names into the log; keep the mapping
   in the restricted evidence store.
3. **When:** the earliest and latest moment the data was reachable, from the audit trail and the
   provider's own record.
4. **Who had it:** an unknown outsider, a named other user, a provider, or no one (exposure possible,
   none shown).
5. **Whether it is over:** access removed and verified (a fresh request is refused).
6. **What is not known**, and why (profile reads are not audited; the provider holds no log).

An honest "we cannot tell, because X is not recorded" is a finding. It is also the answer the
legal reviewer needs in order to decide.

## Notify and escalate (legally reviewed)

- The legal reviewer decides whether a duty to notify exists for each affected person's country and
  for any agency or regulator, and decides the wording and the timing.
- The incident owner decides who else must know now (the agency that owns a case, a provider).
- A notice says what happened, which kinds of data, when, what has been done, what the person
  should do, and how to reach a human. It does not guess at causes or promise outcomes.
- Record in the log who approved each message, when it was sent and through what channel.
- If the incident touches a person's immigration or identity documents, expect that they will worry
  about more than the data itself. Offer a person to talk to; do not offer reassurance you cannot back.

## Recover

1. Remove what let it happen (a share, a role, a key, a bug) and confirm by testing as the unwanted
   party.
2. Reissue anything the person needs (a replacement share, a new invitation) through the product's own
   actions so each step is audited.
3. If protected-field encryption keys could have been exposed with the data, record that the master key
   cannot be rotated today (see the master key section of [secret-compromise.md](./secret-compromise.md))
   and take the legal reviewer's advice on what that means for the people affected.
4. Offer the affected people their data export and, if they ask, deletion. Deletion follows the
   product's normal request path and waits for any legal hold.

## After

Postmortem as in the README, plus: what would have shown this sooner (an alert on unusual exports or on
many refused opens), and whether the audit trail needs to record more (profile reads) to answer the
questions you could not.

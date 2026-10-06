# An account or session is taken over

Use this when someone other than the owner may be signed in as a traveller, an agency member
or a platform administrator, or when the WorkOS dashboard login itself may be in the wrong
hands. Read [README.md](./README.md) first (roles, severity, evidence, who to tell).

If a password manager, a Vercel, GitHub, Neon or WorkOS login is involved, also open
[secret-compromise.md](./secret-compromise.md) now. That is a bigger incident than one account.

## What you are protecting, and what limits the damage today

- A person signs in through WorkOS. The app holds no password. The WorkOS user is the
  identity, and the app account is bound to it by the WorkOS user id.
- Every signed-in request re-checks the person's pilot invitation (`withSession` calls
  `checkPilotAccess`), so revoking an invitation shuts the door on the next request even with a
  live session.
- A staff session (anyone with an organization membership or a platform role) cannot outlive
  12 hours from sign-in, and a traveller session cannot outlive 7 days, even if never revoked.
  There is no idle timeout yet.
- Platform roles are `PLATFORM_OWNER`, `SECURITY_ADMIN`, `COMPLIANCE_ADMIN` and `SUPPORT_ADMIN`.
  Granting or revoking is owner-only, audited, and a role is never deleted, only marked revoked.
  The last owner cannot be revoked.
- **Not in place:** multi-factor sign-in is not enforced for staff (known issue 12; check the
  current setting in the WorkOS dashboard before relying on it). There is no idle timeout.
  There is no alert that fires on a suspicious sign-in; someone has to notice.

## How you might find out

- A person says they did not do something, or cannot sign in.
- `/app/admin` Operations, "Operational signals", row "Denied access" is high (many refusals
  in the last hour against the usual rate). Probing by a taken-over account looks like this.
- The audit trail shows an action the owner would not take: `PLATFORM_ROLE_GRANTED`,
  `PILOT_INVITATION_CREATED`, `GRANT_CREATED` to an unknown recipient, `BULK_EXPORT`,
  `ACCOUNT_EXPORTED`, `SUPPORT_GRANT_CREATED`, `ORGANIZATION_*` changes.
- WorkOS shows a sign-in from an unfamiliar place or device.

## Contain (first 15 minutes)

Do these in order. Each one is reversible.

1. **Declare** the incident and open the log (see README).
2. **End every session for the account.** WorkOS dashboard, Users, find the person, Sessions,
   revoke all. (The same action is available to a WorkOS administrator as `revokeUserSessions`.)
   This stops the thief's current browser. It does not stop them signing in again if they hold the
   credentials, which is what the next steps are for.
3. **Shut the door.** In `/app/admin/access`, "Pilot access", revoke the person's invitation, and
   remove their address from `PILOT_ALLOWLIST_EMAILS` in Vercel if it is listed there (an
   environment change needs a redeploy to take effect). They are redirected to the "invite-only"
   page on the next request.
4. **If MFA is enrolled and the second factor may belong to the thief,** reset it in WorkOS
   (`resetUserAuthenticationFactors`), so the real owner re-enrols after the recovery step.
5. **If the account belongs to an organization,** switch the member off (the agency Team page,
   "Deactivate") so their access goes even if they sign in again. If the whole organization is
   affected, suspend it from `/app/admin/organizations`.
6. **If the account holds a platform role,** revoke the role in `/app/admin/access`, "Platform
   roles". If it is the only owner, grant ownership to a second trusted person first (the system
   refuses to remove the last owner). Then revoke any role that account granted since the takeover
   began, and any pilot invitation it created.

Do not delete the WorkOS user or the app account at this stage. Deleting destroys the history you
need and can break the link between the person and their data.

## Revoke what the account created or can reach

- **Shares.** In the traveller's Sharing page, stop any share the account created that the owner
  did not intend (the "Revoke" action; "Pause" is a softer step when you are not sure). Shares to addresses the owner does not recognise come
  first.
- **Invitations.** Revoke pending organization, client and pilot invitations created in the window.
- **Support access.** Check for `SUPPORT_GRANT_CREATED` events in the window and revoke any grant
  nobody can account for.
- **Exports.** Note every `BULK_EXPORT` and `ACCOUNT_EXPORTED` in the window. A file that has been
  downloaded cannot be recalled; that is a data exposure and goes to
  [data-exposure.md](./data-exposure.md).

## Preserve evidence (before cleanup)

Follow the README list. For this scenario also export:

- WorkOS: the user's events and their session list (`userEvents`, `userSessions`).
- The audit rows for the account (queries below), saved with a SHA-256.
- The Vercel runtime log window, searching for the account's reference. Log lines never carry
  the raw address; they carry a short hashed reference (`acct:` followed by twelve characters), so
  compute it the same way: SHA-256 of the lower-cased address, first twelve hex characters.

## Assess

Run these in the Neon SQL editor against the **evidence branch**, never against production, and
only read. Replace the placeholders. All times are UTC.

```sql
-- Everything one account did in the window, newest first.
select seq, occurred_at, event_type, result, applicant_id, resource_type, resource_id,
       mission_id, grant_id, reason, ip
from audit_events
where actor_account_id = '<account uuid>'
  and occurred_at >= '<start of suspected takeover>'
order by seq desc;

-- Whose data it touched, and how much.
select applicant_id, count(*) as events,
       count(*) filter (where result = 'DENIED') as refused
from audit_events
where actor_account_id = '<account uuid>'
  and occurred_at >= '<start of suspected takeover>'
  and applicant_id is not null
group by applicant_id
order by events desc;

-- Documents opened, previewed or downloaded by the account.
select occurred_at, applicant_id, resource_id, event_type, result, ip, device
from audit_events
where actor_account_id = '<account uuid>'
  and event_type = 'DOCUMENT_ACCESS'
  and occurred_at >= '<start of suspected takeover>'
order by seq;

-- Roles, invitations and support grants created or changed in the window.
select seq, occurred_at, event_type, actor_account_id, resource_type, resource_id, reason
from audit_events
where event_type in ('PLATFORM_ROLE_GRANTED', 'PLATFORM_ROLE_REVOKED',
                     'PILOT_INVITATION_CREATED', 'PILOT_INVITATION_REVOKED',
                     'SUPPORT_GRANT_CREATED', 'SUPPORT_GRANT_REVOKED',
                     'ORGANIZATION_INVITATION_CREATED', 'CLIENT_INVITATION_CREATED')
  and occurred_at >= '<start of suspected takeover>'
order by seq;
```

Answer, in writing, for the log:

1. When did the takeover start? (The earliest event or sign-in that is not the owner's.)
2. Which accounts, applicants, cases and documents did it reach, and what could it do there?
3. Was anything changed, shared, exported or deleted? By which event?
4. Is the thief still in? (Sessions revoked, door shut, no new events since.)
5. How did they get in? (A phished password, a reused password, a stolen device, a leaked
   secret.) If unknown, say so.

The `ip` and `device` columns are only as good as what the request carried; treat them as clues.

## Notify and escalate

If the account could open other people's documents or profiles, go to
[data-exposure.md](./data-exposure.md). The legal reviewer decides who is told and how. Tell the
account's owner promptly through a channel the thief cannot see (a phone call to a number you
already hold, not a number in the account).

## Recover

1. The owner chooses a new strong password in WorkOS (or sets one through the sign-in screen's
   reset), enrols MFA, and checks the list of devices.
2. Re-enable the person's access: a new pilot invitation, and for staff the membership or role,
   with a reason written in the audit trail. Do this only after the cause is understood.
3. Undo anything the thief changed that the owner did not intend. Use the product's own actions
   (a revoke, an edit) so each undo is itself audited. Never edit tables by hand.
4. For an administrator takeover, also read the audit trail for the whole window with fresh eyes,
   and check the WorkOS dashboard for changed redirect addresses, new API keys and changed sign-in
   settings.

## After

Postmortem as in the README. Specific questions: would multi-factor sign-in for staff have stopped
this, and should it now be enforced? Did anyone notice by themselves, or did the owner report it?
Is an alert on unusual sign-ins worth setting up in WorkOS?

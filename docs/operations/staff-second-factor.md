# Staff authenticator codes

Applies to every account that holds a platform role (and the one-time ADMIN_EMAILS bootstrap address). Added in package S3 of Small Commercial V1 (register item M08).

## What it does

- Each staff member sets up an authenticator app once, on the page `/app/staff-code`. They scan a picture (or type a key), enter the first code, and are shown ten backup codes once.
- When the switch is `required`, staff enter one code per sign-in before any platform page opens, and a fresh code (proved in the last five minutes, on top of the recent password check) for every sensitive action. The code check sits inside the existing step-up functions, so every sensitive action is covered without editing its caller.
- A code works once. Five wrong tries in five minutes (or twenty in a day) lock the account out of codes for the rest of the window, even for a correct code; waiting or an owner reset is the way out.
- The secret is encrypted with the application key service and bound to the account. Backup codes are stored only as hashes and work once.
- Nothing readable is written to the audit trail: only kinds and counts (set up, failed, locked, backup code used, backup codes replaced, reset).

## The switch

`STAFF_SECOND_FACTOR` in Vercel: `off` (default) or `required`. Any other value counts as `required`, so a typo asks for more, never for less.

## Turning it on (owner steps)

1. The migration `0092_staff_second_factors` has run (owner word for that run).
2. Every staff member opens `/app/staff-code`, sets up the app and saves the backup codes. The Access page shows how many have done so.
3. Test: sign out, sign in, open a platform page and enter a code.
4. Set `STAFF_SECOND_FACTOR=required` in Vercel and redeploy.

To go back: set it to `off` and redeploy.

## While the table is missing

With the switch `off` nothing is asked and the pages say the codes are not required yet. With `required` and no table, platform pages and sensitive actions are paused with a plain message (fail closed).

## Lost phone

1. Use a backup code in the same box (the page accepts either).
2. No backup code: another platform owner opens Platform Access and chooses Reset Authenticator for that person (needs a recent password check and a written reason, audited). They then set up again.
3. The owner's own lost device, with no other owner and no backup codes (manual, on purpose):
   - In the Neon console SQL editor run: `delete from staff_second_factors where account_id = (select id from accounts where email = '<owner email>');`
   - Sign in and set the app up again.
   - Write the event up in `docs/operations/incidents/`.
   - Keep a second platform owner so this is rare.

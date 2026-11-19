# WAL10 records: Home People photo and Needs Attention rows

Owner request, 18 Nov 2026: the People card of the signed-in person did not show their account photo, and Needs Attention was still a plain stacked list. Guardian decision: upgrade Needs Attention onto the Wallet Foundation in the same unit.

## What changed

| Where | Change |
|---|---|
| apps/web/src/app/app/(home)/home-cards.tsx | The People card uses the shared round photo component. `ownPhotoFor` gives the account photo only to the account's own Myself record (relationship SELF, owned by this account, same record the sidebar account card uses). Everyone else keeps initials. |
| apps/web/src/app/app/(home)/page.tsx | Reads the photo through `loadOwnPhoto`, the same memoized read the sidebar uses (no new query, no service or permission change). Needs Attention renders one row component per item. |
| apps/web/src/app/app/(home)/attention-row.tsx (new) | One Expandable Section row per item: picture (document drawing for document items, one mark otherwise), title, urgency word and person line, one action button. The reason shows as one clamped line in the row; the full sentence sits inside the row and opens with a tap. The urgency word, person and date stay visible. |
| apps/web/src/app/globals.css | One block, WP-WAL10, at the end. |

## Kept as it was

- Item order (urgency), the 8-item limit and "Showing N of M" line, every link and button wording, the expired-document "Tidy Up" banner, the data source.
- Truthful wording: "Nothing is added to the profile until you approve it." stays inside the Suggested row.
- Photo address stays same-origin (CSP `img-src 'self'`), empty alt text, 56 px avatar, a broken or missing photo shows initials.

## New or changed English words (for the localization lane)

None. No English text was added or reworded; the urgency words, headings and button labels are the existing ones.

## Tests

- apps/web/src/app/app/(home)/home-cards.test.tsx, attention-row.test.tsx, apps/web/src/app/app/page.test.tsx (photo on own Myself only, other person and other-owner record never, read failure shows initials, one row and one action per item).
- apps/web/e2e/wallet/wal10-home.spec.ts with fixture apps/web/e2e/fixtures/wal10-home.fixture.tsx: layout guards at 390, 400 and 1280, 44 px actions, photo and fallback, no-script rows, reduced motion, accessibility.

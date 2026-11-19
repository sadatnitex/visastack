# NAV3 records: signed-in public header, sign out everywhere, footer spread (19 Nov 2026)

Owner request (19 Nov 2026, exact words): "also for example, someone is on home/landing page in signed-in state, header shows "বাংলা and Workspace" in the right side, no sign-out option, user needs to get into workspace, then account menu, then signout. what cn we do without damaging the applge grade design". Mock approved ("mock OK") with: "okay. But footer conntents should be justified, not left leaned". Mock: section "Signed in: header and menu (planned)". The label stays "Your Account", as in the app.

## What changed

- Public header, signed in: the Workspace pill and the language switch stay; a small round account button (initials, 44 px) sits beside them and opens the workspace's own account menu in a small public form: first name, Workspace, Your Account, Sign Out (last, set apart). It reuses `AccountMenu` (`variant="public"`, rows passed in), so the keyboard model (arrows, Home, End, Escape, outside tap, focus back to the button) and the phone bottom sheet are the app's own. The workspace menu is unchanged.
- Phone (560 px and below): no room for a second round button, so the page Menu ends with a block of Workspace, Your Account, Sign Out. From 401 to 440 px a signed-in bar shows the Menu button as an icon only (its name stays "Menu"); at 412 px the label pushed it onto a second row.
- Footer, signed in: the Account group lists Workspace and Sign Out (no Get Started). Signed out is unchanged.
- Footer for everyone: link groups spread edge to edge (computers: brand at the left edge and the three groups to the right edge; tablets: brand row, then the groups across the full width; phones: an even two-column grid filling the width, the brand line and the Public Beta line centred).
- Sign Out everywhere (account menu, phone menu block, footer) is the same server action form as the workspace menu (`signOutCurrentUser('/', form)`, a POST with Next's own origin and token checks, the share-inbox and alert cleanup components included). No link, no new route. After sign-out the person lands on the home page, as in the app.
- Privacy: the name is the first word of the session's display name (`lib/public-account.ts`, new file, same Neon identity read the in-app card uses); an address used as a name reads as no name. The email is never put on a public page. Pages stay `Cache-Control: private, no-cache, no-store` because the layout reads the session.

## Files

`layout.tsx` (wiring), `site-footer.tsx` (one prop, one list item), `account-menu.tsx` (backward-compatible `variant` and `links` props), `globals.css` (block `WP-NAV3`), `lib/public-account.ts` (new, approved by the Guardian), tests `layout-nav3.test.tsx`, `public-account.test.ts`, `e2e/public-site/nav3-footer.spec.ts`. No new words: every label already existed in English and Bengali (`home.layout.workspace`, `appHome.appAppNav.yourAccount`, `appHome.appWorkspaceFrame.signOut`, `appHome.appAccountMenu.*`).

## Checked

See the PR for the exact results. Signed-in browser run (local, a build with a temporary signed-in switch that is not in the PR): button 44 px with its name and open state, menu rows, Escape closes and returns focus, no sideways scroll, no clipped item, axe clean in English and Bengali at 360, 390, 412, 768, 1024, 1180, 1440. The signed-out header markup is byte-identical to main in both languages (rendered and compared).

## Not covered by a CI test

The signed-in header in a real browser needs a session; the unit tests cover its markup, and the signed-in guard (`ci-signed-in`) has no NAV3 check yet (outside this unit's files). Suggested follow-up: one guard test that opens `/` as the made-up traveller and signs out from the account button.

## Added scope (owner, 19 Nov 2026, "2-Do")

The Status page's About This Version card said "Some features are still being switched on. This page shows what works today." in English only. It now goes through `status.statusStatusView.publicBetaDetail` (`PUBLIC_BETA_DETAIL` in `pilot-banner.tsx`, looked up by `status-view.tsx`; the card's version name also reads from the home catalogue, so it matches the footer). Bengali, written at the owner's word as a draft that needs the owner's later review (not marked reviewed or released): "কিছু ফিচার এখনো চালু করা হচ্ছে। আজ কী কাজ করছে, তা এই পাতায় দেখা যায়।" Register row SG-856e3570 (id minted from the English words, not by the census tool) in `VISASTACK_TRANSLATION_REGISTER.csv`; `PUB-bn-words.csv` row updated.

## Review fixes (Guardian review, 19 Nov 2026)

- The round button shows two letters (the workspace rule, `lib/account-initials.ts`, now shared with the account menu) while the label stays the first name; the letters are worked out on the server, so the rest of the name is not in the page.
- `lib/public-account.ts` hands Next's own control-flow signals back to Next (as `isSignedIn` does) and fails quiet on any other error.
- On pages the workspace frames (`/app`, the signed-in answers page) the public header draws no account menu, phone block or Sign Out, and the footer draws no Sign Out, so those pages do not carry a second copy (the stylesheet already hides the public header and footer there).
- Phone footer: the Sign Out row takes the same negative margin as the other link rows. Measured at 360 and 390 px, signed in and out, English and Bengali: 3 rows, every row 44 px tall, Sign Out on the same row line as its neighbours, footer 219 px (English) and 228 px (Bengali), inside the 4 rows and 240 px budget.

# Tokens and components

Implementation: `apps/web/src/app/globals.css`, `components/ui.tsx`, `components/icons.tsx`, `app/app/app-nav.tsx`, `app/auth/auth-ui.tsx`.

| Role | Light | Dark |
| --- | --- | --- |
| Page | #F9F8F5 | #102937 |
| Content | #FFFFFF | #183844 |
| Secondary surface | #F0EEE8 | #203F4A |
| Text | #152B37 | #F9F8F5 |
| Secondary text | #304450 | #D1E3DD |
| Supporting text | #526862 | #B4CDC5 |
| Action | #087A68 | #075D54 |
| Link / focus | #087A68 | #9AE0C9 |
| Selected | #D9F3E9 | #254B48 |
| Display emphasis | #B54A3E | #F5B4A5 |

Supporting text is darker than the reference muted #82908E for normal-text contrast. Controls use the stronger supporting border, while decorative card boundaries retain subtle hairlines. Warning text #865014 is derived from the reference amber for readable normal text. Dark colors derive from the supplied navy/mint palette. Contrast measurements and browser findings are recorded in the accessibility report, not inferred from this table.

Radii: 10 / 16 / 22px plus pills and circular avatars. Spacing retains existing 4/8/12/16/24/32/48/64px rhythm. Actions and principal controls have 44px targets. Existing lightweight line icons and self-hosted lawful fonts are reused.

Existing shared components cover page headings, next action, notices, status, metrics, lists, tables, forms, disclosures and empty/loading states. The actual shared authentication shell and workspace toolbar are updated. DocumentReviewPanel renders authorized metadata only and submits the existing preview action; it never embeds unchecked document bytes. Sharing presents existing grants before the existing grant form.

Refinement: light success text is #075D54 on #D9F3E9, and danger text is #963932 on #FBE9E5. White action text retains its accessible solid fills. Document search filters only the already-authorized metadata passed by the existing owner-scoped page. No search endpoint or wider data query is introduced. Safety badge tones come from the page's existing safety-label mapping; search never turns a blocked document into an available preview.

Selected navigation and registration labels use the separate selected-text token (#075D54 light, #9AE0C9 dark) on the selected mint surfaces. Icons retain their existing accent; text is evaluated at the normal-text threshold.

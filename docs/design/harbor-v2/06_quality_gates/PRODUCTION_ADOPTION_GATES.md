# Harbor Blue — Production Adoption Gates

These steps should be wired into the **actual VisaStack repository** only after repository inspection; the current package is not deployed and does not presume a particular CI stack.

## Gate A — Immutable reference

```
sha256sum 00_authority/CONCEPT1_FROZEN.html
# must equal 894253b7a9d8ebb56abd522d8237a8768476ad98555f779e5efced815d522a10
python 06_quality_gates/verify_harbor_lock.py
```

Result: 136 DOM elements and 32 computed non-color properties matched at 1440/1024/768/390. No theme-induced geometry drift. **768 source overflow remains a release blocker for real homepage.**

## Gate B — Palette scope / no hardcoded brand colors

- Source `01_tokens/HARBOR_TOKENS.json` is sole Harbor color record.
- For product source files touched by conversion, disallow hardcoded brand greens/purples/teals, hex-typed blue substitutes, arbitrary Tailwind color classes, new `font-family`, radius, shadow, transition and gradient values unless the diff points to a source C1 selector or owner-approved extension.
- Do not blacklist official uploaded images, flag colors, status colors, document thumbnails or legacy functional code without understanding their purpose.
- Programmatically check **which component source** is entitled to introduce a style. The component/route IDs in the registers are the review authority for this process.

## Gate C — Screenshot baselines (full UI, not only hero)

Test viewports: **1440, 1024, 768, 390**. In addition check 200% zoom and mobile operating-system font metrics. For each changed route, capture authenticated and unauthenticated variants as applicable, plus states: empty, partial, processing, ready, expiring, rejected, revoked, permission denied, session expired, version conflict, loading and network failure. Source images or AI-generated mockups are NOT acceptable baseline evidence for actual code.

Use deterministic fixture records; no customer private data. Diff anti-aliasing/font-rendering environments on a fixed CI image. Reviewer must inspect typography, hierarchy and expected changes, not rely solely on percentage screenshot similarity.

## Gate D — Accessibility and device integrity

Semantic navigation, H1 structure, 4.5:1 normal text contrast, 3:1 relevant non-text boundaries/large text, keyboard focus/escape/labeling, meaningful error copy, pointer target sizing, no hidden horizontal scroll, no content masking at 390px, long copy/Bangla wrap, reduced motion. Landing known 768 overflow requires scoped documented correction. The mobile C1 illustrative notifications occasionally overlap visual content; assess legibility and correct via a separate narrow approved exception if it materially obstructs access.

## Gate E — Product truth and privacy

Verify actual permissions for list, view, preview, export, download, upload, replacement, revision, sharing, grant expiry/revocation, cross-tenant access, agency onboarding, accepted invitations, and access audit. Changing colors never changes access. Don't show green for mere `configuration`; don't claim a document's `current version` is authentic or visa-approved. No false security badges.

## Gate F — Release decision

Each PR states:

```
Reference SHA:
Harbor token SHA:
Changed route IDs:
Changed component IDs:
C1 selector / owner extension hash per styling diff:
At 1440/1024/768/390 snapshots:
Accessibility test evidence:
Existing feature/regression evidence:
Security/access scope assessment:
Outstanding source defects:
Owner approval + date:
Verdict: PASS / BLOCK
```

**BLOCK** if any new app screen design is unsupported by an approved reference, if C1 geometry changes without a signed exception, if permissions cannot be independently tested, or if the UI implies unverified features/security/trust.

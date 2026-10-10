# Visual regression report

Baseline main: `7f9a9fe0ef1b9aef95c38bef9e48939284ec7535`. Before capture: 32 screenshots of home, trust, sign-up and existing shared-workspace HTML fixture at 1600, 1440, 1280, 1024, 768, 390, 375 and 320px. No body overflow or 5xx responses observed. The local trust capture may show the honest provider-unavailable state.

Artifacts are outside the checkout under `/workspace/.cloud-tools/uiux/`. Supplied PDF pages are rendered under `reference/`. Actual server-page test renders are captured with source/test provenance under `fixtures/`. They use synthetic unit data and some client placeholders; they are not authenticated production screenshots.

After comparison is pending. Added browser scenarios use actual React shared components, ProfileEditor, GrantForm, DocumentReviewPanel and navigation with test-only action stand-ins. Full PDF pixel similarity is inappropriate because of variable records, retained capabilities, responsive reflow and forbidden decorative effects.

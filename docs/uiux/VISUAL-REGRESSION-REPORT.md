# Visual regression report

Baseline main: `7f9a9fe0ef1b9aef95c38bef9e48939284ec7535`. Before capture: 32 screenshots of home, trust, sign-up and existing shared-workspace HTML fixture at 1600, 1440, 1280, 1024, 768, 390, 375 and 320px. No body overflow or 5xx responses observed. The local trust capture may show the honest provider-unavailable state.

Artifacts are outside the checkout under `/workspace/.cloud-tools/uiux/`. Supplied PDF pages are rendered under `reference/`. Actual server-page test renders are captured with source/test provenance under `fixtures/`. They use synthetic unit data and some client placeholders; they are not authenticated production screenshots.

After comparison is pending. Added browser scenarios use actual React shared components, ProfileEditor, GrantForm, DocumentReviewPanel and navigation with test-only action stand-ins. Full PDF pixel similarity is inappropriate because of variable records, retained capabilities, responsive reflow and forbidden decorative effects.

## Exact-reference correction, 2026-10-11

All ten original HTML sections were rendered at 1600 by 1000 before this correction changed styling. Forty before screenshots and forty corrected screenshots cover the ten mapped surfaces at desktop 1600 by 1000 and phone 390 by 844, each under both device color preferences. Public screens are actual routes; seven workspace captures use the actual React components with synthetic records and no authenticated session. These are browser mobile viewports, not physical-device certification.

The original/before/corrected desktop comparison is [all-ten-desktop.jpg](evidence/all-ten-desktop.jpg). The corrected phone light/dark comparison is [phone-light-dark.jpg](evidence/phone-light-dark.jpg). All twenty corrected light/dark pixel pairs are identical; [appearance-parity.json](evidence/appearance-parity.json) records the checks. No captured screen has horizontal overflow. The full-size source captures remain in the execution artifacts.

Measured desktop geometry: public header 1448 by 72, 38-pixel radius, x=76; hero headline 91 pixels, weight 545, x=107; demonstration card 516 pixels wide with 27-pixel radius; navy summary 1448 by 225 with 24-pixel radius; workspace sidebar 256 pixels wide with #f1f3ee surface; toolbar 83 pixels high on white; workspace content #fafaf7. The mandatory pilot notice adds 44 pixels above desktop compositions. The real longer case illustration makes its card about 394 rather than 382 pixels tall; actual trust copy makes its hero about 481 rather than 470. Form and permission copy retain their real limits instead of being shortened to false promises.

The screenshot checks compare fresh workspace renders because a runtime media toggle can repaint a few fractional native-input border pixels in Chromium. Exact pixel equality remains the assertion. Public routes additionally compare appearance during a runtime preference change. The static guard rejects reintroduced automatic dark CSS; deliberate mutation of the actual stylesheet failed, restoration passed. These checks do not establish signed-in production data correctness. Final source and deployment results are recorded on the release pull request.

Verification finding: removing the duplicate public footer exposed missing space below the fixed mobile workspace bar. The bottom reserve is now outside the main content, preserving the original last-line clearance assertions. The public-header reachability check opens the actual public menu, since the workspace intentionally no longer contains a second public header. Its visibility and geometry assertions remain. Initial failed checks are retained in the execution logs and are not counted as passing release evidence.

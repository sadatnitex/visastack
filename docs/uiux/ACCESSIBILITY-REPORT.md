# Accessibility report

Status: verification in progress. Do not claim full WCAG conformance from automated checks.

Plan: existing axe public checks; added dark profile/document/sharing/agency/admin synthetic fixtures; explicit More-menu focus entry/Escape return; 320px reflow, eight viewport sizes; persistent form labels; status symbols; explicit outline focus; reduced motion and safe document selection. Text-token contrasts will be measured and recorded after final styling. Existing privileged browser acceptance remains credential-dependent and is reported separately.

## Token measurement, 2026-10-11

Measured sRGB relative-luminance ratios for the actual source tokens:

| Scheme | Text / surface | Contrast |
| --- | --- | --- |
| light | `--text` / `--bg` | 13.8:1 |
| light | `--text-secondary` / `--bg-elevated` | 10.15:1 |
| light | `--text-tertiary` / `--bg-subtle` | 5.15:1 |
| light | `--accent` / `--bg` | 4.95:1 |
| light | `--success` / `--success-bg` | 6.64:1 |
| light | `--warning` / `--warning-bg` | 5.91:1 |
| light | `--danger` / `--danger-bg` | 6.11:1 |
| dark | `--text` / `--bg` | 14.18:1 |
| dark | `--text-secondary` / `--bg-elevated` | 9.33:1 |
| dark | `--text-tertiary` / `--bg-subtle` | 6.67:1 |
| dark | `--accent` / `--bg` | 9.95:1 |
| dark | `--success` / `--success-bg` | 6.37:1 |
| dark | `--warning` / `--warning-bg` | 7.28:1 |
| dark | `--danger` / `--danger-bg` | 7.52:1 |

All listed normal-text pairs clear 4.5:1. These token measurements are not a complete page audit. Final rendered-browser axe results and manual acceptance limits are reported separately. Initial lighter success/danger text measured below 4.5:1 and was corrected before release.

Selected-label measurements: light 6.64:1, dark 6.37:1. Icons use the separate non-text threshold; no token-only result is presented as page certification.

## Reference correction, 2026-10-11

The public phone menu focuses its first actual destination, supports Escape and returns focus to its trigger. Workspace navigation retains its existing focus and role behavior. Native controls stay in the approved light scheme regardless of device preference. Existing skip links, language switching, readable validation, real sharing controls and secure document actions remain. Automated axe, responsive and browser-security checks are retained rather than replaced with token comparisons. Minimum 44-pixel primary targets intentionally exceed several smaller desktop reference controls.

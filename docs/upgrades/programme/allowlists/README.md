# Allowlists

One file per work package, named `<WP>.txt` (for example `WP-L1.txt`). One glob per line. `#` starts a comment. `**` spans folders, `*` stays within one folder, square brackets are literal (Next.js route folders such as `[id]`).

The first commit on each package branch adds its allowlist, seeded from the package in `../WORK-PACKAGES.md`. The owner approves it before any other file is edited. Check with:

```text
node scripts/programme/check-allowed-paths.mjs docs/upgrades/programme/allowlists/WP-L1.txt --no-emdash --exclude docs/design/harbor-v2
```

#!/usr/bin/env bash
# Renders every page of the product against the made-up preview world and writes plain HTML to
# apps/web/.preview/l10n/html (git-ignored). Copies the harness into apps/web/preview for the run
# and removes it afterwards, so no product file is changed. Needs: pnpm install.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cp "$ROOT/docs/localization/tools/l10n-render.preview.tsx" "$ROOT/apps/web/preview/l10n-render.preview.tsx"
trap 'rm -f "$ROOT/apps/web/preview/l10n-render.preview.tsx"' EXIT
cd "$ROOT/apps/web"
./node_modules/.bin/vitest run -c vitest.preview.config.ts preview/l10n-render.preview.tsx

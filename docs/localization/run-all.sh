#!/usr/bin/env bash
# Regenerates every file in docs/localization from the repository. Documentation and data only.
# Needs: pnpm install, Node 22, Python 3, Chromium at /opt/pw-browsers/chromium.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
T=docs/localization/tools
bash $T/run-render.sh                 # draw every page against the made-up preview world
node --test $T/text-markers.test.mjs   # the regex-free scanner used by the tools
node $T/census.mjs                    # parse the source with the TypeScript compiler API
node $T/rendered-check.mjs            # compare drawn screens with the census
node $T/build-census.mjs              # routes, roles, semantic groups, VISASTACK_UI_SOURCE_CENSUS.csv
(cd docs/localization && python3 tools/evidence-verify.py)   # re-fetch every attested row (needs network) and classify it
python3 $T/glossary.py                # core glossary
(cd docs/localization && python3 tools/glossary-join.py && python3 tools/attestation-report.py)   # classify each term; write attestation status
python3 $T/existing-review.py         # review of the Bengali already in packages/i18n
node $T/register-inputs.mjs           # drafting input set
node $T/build-register.mjs            # VISASTACK_TRANSLATION_REGISTER.csv (needs data/drafts/bn-BD.part-*.jsonl)
node $T/journey-packet.mjs            # review packet screenshots
node $T/format-rules.mjs              # number and date rules and audit
python3 $T/flagged-audit.py            # disposition of the 231 flagged drafts (reads git history)
node $T/guardrails-doc.mjs            # VISASTACK_SEMANTIC_GUARDRAILS.md
node $T/coverage-report.mjs           # VISASTACK_COVERAGE_REPORT.md
node $T/sample-checks.mjs            # anchors re-checked against the real files
node $T/guardrail-check.mjs --self-test
./node_modules/.bin/biome check --write docs/localization   # keep generated JSON and scripts in the repo's format

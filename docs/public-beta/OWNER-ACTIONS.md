# External actions and inspection limits

Complete independent engineering before requesting these actions. Never supply credentials in chat.

| System | Action / evidence needed | Why | Cost / reversibility |
| --- | --- | --- | --- |
| GitHub access from cloud | Permit api.github.com and verify existing scoped API authentication | Inspect open PRs, current checks and prepare/review PR; native Git access alone does not establish API permission | Network setting, no plan change; reversible |
| Browser test runtime | Permit cdn.playwright.dev or provide an installed compatible Chromium | Browser download returned proxy 403; public accessibility/CSP browser checks are not yet run | Free local test dependency; reversible |
| Vercel deployment inspection | Access exact deployment SHA and provider scope for the candidate | Same source SHA is not proof of identical provider settings; public production endpoint is proxy-blocked here | Read-only access; no plan change |
| Isolated acceptance fixtures | Confirm a dedicated staging branch/project and consenting synthetic inboxes before account/email operations | Actual login, recovery, delivery, staff assurance and cross-party journeys | Account allowances/hosting terms must be measured |
| Production data scope | Confirm whether real customer records exist before any linking/data migration | Preserve identity and avoid copying sensitive data into development | Inspection only; no data mutation |
| Neon privileged assurance | Verify managed-provider MFA capability and reviewed staff policy | Password re-check is not a second factor | Provider-dependent; no invented assurance |
| Sensitive documents | Verified scanner, managed keys, independent backup, restore and independent review | Real identity-document protection must be proven before activation | Provider/owner decisions in PR-04 |
| Public activation and legal | Approve reviewed disclosures and the particular activation action when candidate is verified | Code completion is not public or commercial launch authorization | No activation performed in this patch |

No production migrations, key rotation, paid upgrades, emails or signup resets were performed during baseline work. No new API token is requested before existing authentication and network access are tested.

A supplemental cloud configuration draft was saved successfully on 2026-10-10. It adds api.github.com, cdn.playwright.dev and visastack-five.vercel.app to the five existing explicit destinations, preserving those destinations and the package-manager preset. Startup instructions now distinguish the built catalog failure and the unexecuted browser checks. Installation commands and secret bindings were not changed. User publication is still required; these blocked operations have not been retried or verified under the new policy.

Owner standing instruction (2026-10-10): keep Neon projects below the reported ten-branch limit, with at most nine retained branches. Proactively remove confirmed unused branches after checking production, active deployments, open work, database/auth references, branch dependencies and recovery requirements. Protect working branches; capacity pressure does not authorize breaking them. Current cloud tools expose no Neon management API and no Neon management credential is present. Branch count and deletion eligibility cannot be verified here; no Neon branch was deleted. Database and Neon Auth connectivity do not confer branch-management access.

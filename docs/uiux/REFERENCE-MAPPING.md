# Reference mapping

| Reference | Existing implementation | Preserved behavior / intentional adaptation |
| --- | --- | --- |
| 01 Home | `/`, aligned two-column hero, case example and lower sections | Labelled made-up example; actual registration flag controls CTA; no floating or tilted panels |
| 02 Trust | `/trust`, `/privacy`, `/terms`, published route details | Actual privacy and sharing limits; maintained route catalog retained; no fake revocation controls |
| 03 Signup | All seven `/auth/*` pages through AuthShell | Solid split composition; actual Neon validation, notices and recovery; no fake actor toggle |
| 04 Traveller | `/app`, AppNav, WorkspaceToolbar, shared record cards | Existing authorized counts, consent, attention and family navigation |
| 05 Profile | Applicant layout, profile editor, history | Actual immutable facts, repeating groups, search and assurance retained |
| 06 Documents | Document list, existing uploader/review actions, new metadata panel | Existing authorization and safety gate; secure preview opens through server action, never a synthetic embedded document |
| 07 Case | Mission page, snapshots, checklist and contextual controls | Existing case machine, sources and exact-version acknowledgements; no approval prediction |
| 08 Sharing | Applicant sharing page, grant list, actual GrantForm | Existing scope, acceptance, pause/revoke and history; no change to permission semantics |
| 09 Agency | Authorized organization header/tabs, dashboard, clients/cases/team/settings/plan | Existing membership-scoped sections retained; no invented evidence-request or chart destinations |
| 10 Admin | Authorized platform tabs and all operational pages | Actual provider/queue/access/privacy/audit state; no fabricated cost or adoption metrics |

Global navigation retains family/applicant context and role-filtered secondary sections rather than replacing supported routes with the mockup's illustrative single-person navigation. The mockups contain capabilities and figures that are illustrative, not release requirements to invent backend systems. Decorative effects are explicitly removed.

Document-wallet refinement adds a real filename search over the authorized metadata selector and an explicit no-results state. Existing upload, categorization, versions, expiry, human review and AI controls remain in the list beside it. The preview pane retains the secure action instead of loading an unchecked embedded file.

## Original HTML correction, 2026-10-11

The exact original HTML, with the identity above, was rendered without CSS substitution and all ten sections inspected. The header now follows its 1448 by 72 desktop pill, the public hero its 91-pixel serif-emphasized hierarchy, authentication its 740/860 split at 1600 pixels, and workspaces their 256-pixel sidebar and 83-pixel toolbar. The implementation keeps its existing self-hosted Inter; the attachment names Inter but supplies no font asset, so its browser fallback is not represented as a different intended typeface.

Public trust preserves the 470-pixel hero, permission illustration and four control cards while keeping the actual published-route catalog and unavailable state. Every illustration remains explicitly synthetic. Product navigation uses actual supported destinations; the page finder searches navigation labels only, and platform administration appears there only for an authorized administrator. No record search or unsupported dropdown is simulated. Phone navigation is one compact row with a keyboard-accessible menu.

# Navigation and lifecycle review

Owner direction: a minimal, flat product that people can navigate without technical knowledge. Clear labels, consistent placement, recognition rather than recall, visible next steps and progressive disclosure guide this change. These are design principles, not a claim that this specific interface has been validated by neuroscience or user research. Real authenticated usability acceptance remains open.

## Navigation ownership

Sidebar and mobile More: current workspace, switching travellers/agencies/platform where authorized, documents, cases, sharing, clients, team, activity and contextual workspace settings. Account menu: personal account/plan information, privacy and consent, help, service status and sign-out. Personal settings and workspace settings are distinct. The trigger shows only name and a downward chevron; the complete name remains available to assistive technology. Long names truncate without widening the toolbar. More uses a solid mint surface, contrasting dark border, explicit navigation heading and close control, retaining Escape, outside dismissal and existing links.

## Agency policy: current and proposed

Current: an authenticated account can create an organization with a name. The creator becomes OWNER, the organization starts PENDING_VERIFICATION, and activation requires a platform reviewer who is not a member. Membership alone never grants access to traveller records. Active standing and accepted sharing permissions remain separate requirements. The creation path does not currently impose a per-account pending-application cap or collect a structured business-verification package.

Recommendation, not an implemented permission change: allow anyone to apply, but restrict client-facing agency operation to approved agencies. Add a configurable application rate limit, one pending application per account initially, legal/business name, country, business contact, website where available and jurisdiction-appropriate verification evidence. Use duplicate review, a review reason and appeal/reapplication flow; require stronger staff authentication before sensitive operations. Avoid blanket global licensing claims. Existing founding access remains complimentary. The owner must decide the final approval criteria before changing business policy.

## Lifecycle coverage

| Resource | Current behavior | Limitation or next decision |
| --- | --- | --- |
| Account | Self-service deletion request, impact review, reauthentication and legal-hold/sole-owner protections | Execution depends on configured cleanup and verified external erasure; no claim of a new live deletion test |
| Agency | Platform review/rejection, suspension and permanent closure; traveller wallet retained | No general owner self-service archive/delete or pending-application withdrawal is exposed |
| Team membership | Owner/admin activation and deactivation with last-owner protection; assignment cleanup | Deactivation is access removal, not destruction of audit history |
| Sharing | Explicit grant scope, acceptance, pause/resume/revoke and expiry | Revocation ends access; it does not delete a traveller's records |
| Profile/document history | Versioned updates and document lifecycle states, including superseded versions | No blanket per-record permanent-delete UI; whole-account privacy erasure is a separate workflow |
| Visa case | Guarded state transitions and evidence-selection removal | No general case hard-delete or self-service archive flow was found in this audit |

CRUD is a useful coverage checklist, not a reason to expose destructive deletion on every historical record. This system deliberately uses versioned updates, revocation, deactivation and closure where records participate in consent, audit and case history. Missing self-service withdrawal/archive flows should be specified with ownership, reversibility, downstream effects and retention rules, rather than implemented as unrestricted deletes. This review reports source behavior; all significant authenticated lifecycles still require isolated real acceptance tests.

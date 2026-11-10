import type { MessageKey, Translator } from '@visastack/i18n';

const GRANT_STATUS_KEYS: Record<string, { key: MessageKey; tone: string }> = {
  PENDING_ACCEPTANCE: { key: 'grant.status.pendingAcceptance', tone: 'badge-neutral' },
  ACTIVE: { key: 'grant.status.active', tone: 'badge-success' },
  PAUSED: { key: 'grant.status.paused', tone: 'badge-warning' },
  REVOKED: { key: 'grant.status.revoked', tone: 'badge-danger' },
  EXPIRED: { key: 'grant.status.expired', tone: 'badge-neutral' },
};

/** Translated badge label + tone for a grant's status. */
export function grantStatusBadge(status: string, t: Translator): { label: string; tone: string } {
  const entry = GRANT_STATUS_KEYS[status] ?? {
    key: 'grant.status.pendingAcceptance' as const,
    tone: 'badge-neutral',
  };
  return { label: status in GRANT_STATUS_KEYS ? t(entry.key) : status, tone: entry.tone };
}

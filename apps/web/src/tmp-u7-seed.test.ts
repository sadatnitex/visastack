import { createMigratedPglite } from '@visastack/db/testing';
import {
  accountPrincipal, createApplicant, enqueueNotification, listNotificationsForAccount,
  markNotificationRead, provisionAccount, requireAccess, runNotificationWorker, startGroupTrip, listTrips,
} from '@visastack/services';
import { expect, it } from 'vitest';

it('seed sequence works', async () => {
  const db = (await createMigratedPglite()) as never;
  const acct = await provisionAccount(db, { email: 'u7.seed@example.test', emailVerified: true });
  if (!acct.ok) throw new Error('acct');
  const t = acct.value;
  const app = await createApplicant(db, { actorAccountId: t.id, ownerAccountId: t.id, displayName: 'Seed Person' });
  if (!app.ok) throw new Error('app');
  for (const [i, subject] of ['A', 'B'].entries()) {
    await enqueueNotification(db, {
      eventType: 'CASE_MOVED', channel: 'IN_APP', resourceId: `n${i}`, recipientAccountId: t.id,
      payload: { subject, summary: 's', deepLinkPath: '/app' },
    });
  }
  const noEmail = { send: async () => { throw new Error('no'); } };
  await runNotificationWorker(db, noEmail as never, 'http://127.0.0.1');
  const notices = await listNotificationsForAccount(db, t.id);
  expect(notices).toHaveLength(2);
  const r = await markNotificationRead(db, { actorAccountId: t.id, notificationId: notices[0]!.id });
  expect(r.ok).toBe(true);
  const proof = await requireAccess(db, accountPrincipal(t.id), 'MANAGE', { applicantId: app.value.id }, { purpose: 'owner_trip' });
  if (!proof.ok) throw new Error('proof');
  const trip = await startGroupTrip(proof.value, { destination: 'Japan', purpose: 'Tourism', title: 'Japan Test Group Trip' });
  expect(trip.ok, JSON.stringify(trip)).toBe(true);
  const list = await requireAccess(db, accountPrincipal(t.id), 'VIEW_METADATA', { applicantId: app.value.id }, { purpose: 'owner_trip' });
  if (!list.ok) throw new Error('list');
  const trips = await listTrips(list.value);
  expect(trips.ok && trips.value.map((x) => x.title)).toEqual(['Japan Test Group Trip']);
});

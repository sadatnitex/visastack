import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Db } from './db';
import { enqueueNotification } from './notifications';
import type { KeyManagementPort } from './ports';

/** Only ciphertext enters the durable outbox. A database copy cannot recover an invite token. */
export interface SealedInvitationLink {
  readonly keyVersion: string;
  readonly wrappedKey: string;
  /** Which key wrapped it; absent on links sealed before the key service existed (the local key). */
  readonly wrappingKeyId?: string;
  readonly nonce: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export async function queueInvitationEmail(
  tx: Db,
  input: {
    readonly kind: 'team' | 'client' | 'sharing';
    readonly invitationId: string;
    readonly organizationId?: string;
    readonly email: string;
    readonly rawToken: string;
    readonly encryption: KeyManagementPort;
  },
): Promise<void> {
  const dataKey = await input.encryption.generateDataKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey.plaintextDataKey, nonce);
  cipher.setAAD(Buffer.from(`invitation:${input.kind}:${input.invitationId}`));
  const path = `/invitation?kind=${input.kind}&token=${encodeURIComponent(input.rawToken)}`;
  const ciphertext = Buffer.concat([cipher.update(path, 'utf8'), cipher.final()]);
  await enqueueNotification(tx, {
    eventType:
      input.kind === 'team'
        ? 'TEAM_INVITATION_CREATED'
        : input.kind === 'sharing'
          ? 'SHARING_INVITATION_CREATED'
          : 'CLIENT_INVITATION_CREATED',
    channel: 'EMAIL',
    resourceId: input.invitationId,
    recipientEmail: input.email,
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    payload: {
      subject:
        input.kind === 'team'
          ? 'Your VisaStack team invitation'
          : input.kind === 'sharing'
            ? 'Your VisaStack sharing invitation'
            : 'Your VisaStack agency invitation',
      summary:
        input.kind === 'team'
          ? 'You have been invited to join an agency team on VisaStack. Open the link, create an account or sign in using this email address, then review and accept your role. The link expires in 7 days. If you were not expecting it, ignore this email.'
          : input.kind === 'sharing'
            ? 'You have been invited to review shared information on VisaStack. Use this email address to create an account or sign in, review the purpose, permissions and expiry, then accept only if you agree. Opening the link grants no access. This link expires within 7 days. If you were not expecting it, ignore this email.'
            : 'An agency has invited you to work together on VisaStack. Open the link, create an account or sign in, then review the agency and requested access. You choose your profile and confirm sharing before anything is connected. The link expires in 7 days. If you were not expecting it, ignore this email.',
      deepLinkPath: '/invitation',
      sealedInvitationLink: {
        keyVersion: dataKey.keyVersion,
        wrappedKey: Buffer.from(dataKey.wrappedDataKey).toString('base64'),
        ...(dataKey.wrappingKeyId ? { wrappingKeyId: dataKey.wrappingKeyId } : {}),
        nonce: nonce.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      },
    },
  });
}

export async function revealInvitationLink(
  sealed: SealedInvitationLink,
  kind: 'team' | 'client' | 'sharing',
  invitationId: string,
  encryption: KeyManagementPort,
): Promise<string> {
  const key = await encryption.unwrapDataKey(
    sealed.keyVersion,
    Buffer.from(sealed.wrappedKey, 'base64'),
    sealed.wrappingKeyId ?? null,
  );
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.nonce, 'base64'));
  decipher.setAAD(Buffer.from(`invitation:${kind}:${invitationId}`));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const path = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  if (!/^\/invitation\?kind=(team|client|sharing)&token=[A-Za-z0-9_-]{43}$/.test(path)) {
    throw new Error('Invalid invitation link');
  }
  return path;
}

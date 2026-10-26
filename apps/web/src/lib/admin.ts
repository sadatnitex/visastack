import 'server-only';
import {
  type Db,
  type PlatformAction,
  type PlatformAuthInput,
  type StaffScope,
  canPerformPlatformAction,
  hasAnyPlatformRole,
  isPlatformOwner,
  staffPrincipal as mintStaffScope,
} from '@visastack/services';
import { bootstrapAdminEmails } from './admin-emails';
import { staffFactorProvedForSignIn } from './staff-factor';

export { bootstrapAdminEmails };

type Ctx = { readonly accountId: string; readonly email: string };

/**
 * True when the account holds a platform role, whatever the authenticator rule says. Only for
 * deciding who the rule applies to and where to send them (the platform navigation entry, the
 * code page). Every page and action that shows or changes anything uses the checks below.
 */
export async function holdsPlatformRole(db: Db, ctx: Ctx): Promise<boolean> {
  return hasAnyPlatformRole(db, { ...ctx, bootstrapEmails: bootstrapAdminEmails() });
}

/** True if the signed-in account holds any active platform role (or bootstrap applies). */
export async function isPlatformAdmin(db: Db, ctx: Ctx): Promise<boolean> {
  if (!(await holdsPlatformRole(db, ctx))) return false;
  return staffFactorProvedForSignIn(db, ctx.accountId);
}

/** True if the signed-in account is a platform owner (or bootstrap applies) — required to manage roles. */
export async function isPlatformOwnerAccount(db: Db, ctx: Ctx): Promise<boolean> {
  if (!(await isPlatformOwner(db, { ...ctx, bootstrapEmails: bootstrapAdminEmails() }))) {
    return false;
  }
  return staffFactorProvedForSignIn(db, ctx.accountId);
}

/**
 * True if the signed-in account can perform this specific concern-scoped
 * platform action — as PLATFORM_OWNER (or bootstrap) or as the one role the
 * action requires (docs/audits/post-programme-defect-register.md finding
 * #15). Use this instead of `isPlatformAdmin` for every action that has a
 * genuine single-concern owner; reserve `isPlatformAdmin` only for read-only
 * surfaces truly meant for any platform role (e.g. the admin overview page).
 */
export async function hasPlatformPermission(
  db: Db,
  ctx: Ctx,
  action: PlatformAction,
): Promise<boolean> {
  const allowed = await canPerformPlatformAction(
    db,
    { ...ctx, bootstrapEmails: bootstrapAdminEmails() },
    action,
  );
  return allowed && (await staffFactorProvedForSignIn(db, ctx.accountId));
}

/**
 * The staff scope for one platform action, made only when the account holds the role AND, when
 * authenticator codes are required, has proved a code in this sign-in. Use this instead of
 * `staffPrincipal` from the services package in the web app, so a page or action cannot skip the
 * code rule by minting its scope directly.
 */
export async function staffPrincipal<A extends PlatformAction>(
  db: Db,
  input: PlatformAuthInput,
  action: A,
) {
  const minted = await mintStaffScope(db, input, action);
  if (!minted.ok) return minted;
  if (!(await staffFactorProvedForSignIn(db, input.accountId))) {
    return {
      ok: false,
      error: { code: 'forbidden', message: 'Enter your authenticator code first.' },
    } as const;
  }
  return minted as { readonly ok: true; readonly value: StaffScope<A> };
}

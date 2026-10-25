import {
  type ProtectionSwitchView,
  RESTRICTED_DOCUMENT_TYPES,
  getDocumentProtectionOverview,
  staffPrincipal,
} from '@visastack/services';
import type { Metadata } from 'next';
import { Disclosure, PageHeader, StatusBadge } from '../../../../components/ui';
import { bootstrapAdminEmails } from '../../../../lib/admin';
import { formatTimestamp } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';
import { AdminRestricted } from '../admin-restricted';
import { ProtectionSwitch } from './forms';

export const metadata: Metadata = { title: 'Document Protection' };

export const dynamic = 'force-dynamic';

const ON_MEANS =
  'Ask for a fresh sign-in check before anyone previews or downloads these documents.';
const OFF_MEANS = 'These documents open without a fresh sign-in check.';
const UNKNOWN_WARNING =
  'Documents that are not sorted yet could be passports, bank statements or medical records, so turning this off can expose them without a check.';

function onOff(restricted: boolean): string {
  return restricted ? 'On' : 'Off';
}

/** Who last changed a switch, when, and why; or that it uses the standard setting. */
function LastChange({ view }: { readonly view: ProtectionSwitchView }) {
  if (!view.overridden) {
    return <p className="muted u-fs-085">Standard setting, never changed.</p>;
  }
  return (
    <p className="muted u-fs-085">
      Changed by {view.changedByEmail ?? 'a former admin'}
      {view.changedAt ? ` on ${formatTimestamp(view.changedAt)}` : ''}. Standard setting:{' '}
      {onOff(view.defaultRestricted)}.{view.reason ? ` Reason: ${view.reason}` : ''}
    </p>
  );
}

/** Platform admins switch the restricted-document rule on and off here, based on feedback. */
export default async function DocumentProtectionPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'DOCUMENT_PROTECTION_MANAGE',
    );
    if (!staff.ok) return null;
    const overview = await getDocumentProtectionOverview(db, staff.value);
    return overview.ok ? overview.value : null;
  });

  return (
    <section className="section container">
      <PageHeader
        back={{ href: '/app/admin/settings', label: 'Settings' }}
        eyebrow="Platform Settings"
        title="Document Protection"
        description="Choose which documents need a fresh sign-in check before anyone, including the traveller, previews or downloads them. Change a switch when travellers or agencies tell you a check is missing or getting in the way."
      />
      {!data ? (
        <AdminRestricted />
      ) : (
        <>
          <article className="card u-mb-150" id="unsorted-documents">
            <p className="card-kicker">Not Sorted Yet</p>
            <h2 className="card-title">{data.unknown.label}</h2>
            <p className="card-body">{data.unknown.description}</p>
            <p>
              <StatusBadge tone={data.unknown.restricted ? 'success' : 'warning'}>
                Sign-in check {onOff(data.unknown.restricted)}
              </StatusBadge>{' '}
              {data.unknown.restricted ? ON_MEANS : OFF_MEANS}
            </p>
            {data.unknown.restricted ? null : (
              <p className="notice notice-warn">{UNKNOWN_WARNING}</p>
            )}
            <LastChange view={data.unknown} />
            <ProtectionSwitch
              scope="UNKNOWN_TYPE"
              switchKey={data.unknown.key}
              name={data.unknown.label}
              restricted={data.unknown.restricted}
              defaultRestricted={data.unknown.defaultRestricted}
              overridden={data.unknown.overridden}
              offWarning={UNKNOWN_WARNING}
            />
          </article>

          <h2 className="card-title">Document Categories</h2>
          <p className="muted u-mb-125">
            A category switch covers every document in it, including ones added later. A switch on a
            single document beats its category.
          </p>
          <div className="grid">
            {data.categories.map((category) => (
              <article className="card" key={category.key} id={`category-${category.key}`}>
                <h3 className="card-title">{category.label}</h3>
                <p className="card-body">{category.description}</p>
                <p>
                  <StatusBadge tone={category.restricted ? 'success' : 'warning'}>
                    Sign-in check {onOff(category.restricted)}
                  </StatusBadge>{' '}
                  {category.restricted ? ON_MEANS : OFF_MEANS}
                </p>
                <LastChange view={category} />
                <ProtectionSwitch
                  scope="CATEGORY"
                  switchKey={category.key}
                  name={category.label}
                  restricted={category.restricted}
                  defaultRestricted={category.defaultRestricted}
                  overridden={category.overridden}
                />
                <Disclosure
                  title={`Documents in ${category.label} (${category.types.length})`}
                  hint={`${category.restrictedTypeCount} with a sign-in check`}
                >
                  <ul className="field-list">
                    {category.types.map((type) => (
                      <li key={type.key} id={`type-${type.key}`}>
                        <p>
                          <strong>{type.label}</strong>{' '}
                          <StatusBadge tone={type.restricted ? 'success' : 'neutral'}>
                            Sign-in check {onOff(type.restricted)}
                          </StatusBadge>
                        </p>
                        <p className="muted u-fs-085">
                          {type.overridden
                            ? 'Set for this document.'
                            : RESTRICTED_DOCUMENT_TYPES.has(type.key)
                              ? 'On for this document by standard setting.'
                              : `Follows ${category.label}.`}
                        </p>
                        {type.overridden ? <LastChange view={type} /> : null}
                        <ProtectionSwitch
                          scope="DOCUMENT_TYPE"
                          switchKey={type.key}
                          name={type.label}
                          restricted={type.restricted}
                          defaultRestricted={type.defaultRestricted}
                          overridden={type.overridden}
                        />
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

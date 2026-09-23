'use client';

import { useActionState, useRef } from 'react';
import {
  type ActionState,
  removeLogoAction,
  updateBrandingAction,
  uploadLogoAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

function StatusMessage({ state }: { readonly state: ActionState }) {
  if (!state.message) return null;
  return (
    <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>{state.message}</p>
  );
}

/** Org admin management UI for an agency's name, accent color, and logo (Commercial V1 COM-04). */
export function BrandingForm({
  organizationId,
  name,
  accentColor,
  logoUrl,
}: {
  readonly organizationId: string;
  readonly name: string;
  readonly accentColor: string | null;
  readonly logoUrl: string | null;
}) {
  const [brandingState, brandingAction, brandingPending] = useActionState(
    updateBrandingAction,
    INITIAL,
  );
  const [uploadState, uploadAction, uploadPending] = useActionState(uploadLogoAction, INITIAL);
  const [removeState, removeAction, removePending] = useActionState(removeLogoAction, INITIAL);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <form
        action={brandingAction}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '28rem' }}
      >
        <input type="hidden" name="organizationId" value={organizationId} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Agency name</span>
          <input type="text" name="name" defaultValue={name} maxLength={200} required />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Accent color</span>
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            Must have at least 4.5:1 contrast against white (WCAG AA). Leave blank to clear it.
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="color"
              name="accentColorPicker"
              defaultValue={accentColor ?? '#1a73e8'}
              onChange={(event) => {
                const text = event.currentTarget.form?.elements.namedItem('accentColor');
                if (text instanceof HTMLInputElement) text.value = event.currentTarget.value;
              }}
              style={{ width: '2.5rem', height: '2.5rem', padding: 0, border: 'none' }}
            />
            <input
              type="text"
              name="accentColor"
              defaultValue={accentColor ?? ''}
              placeholder="#1a73e8"
              pattern="^#[0-9a-fA-F]{6}$"
              style={{ flex: 1 }}
            />
          </div>
        </label>
        <div>
          <button type="submit" className="btn btn-primary" disabled={brandingPending}>
            {brandingPending ? 'Saving…' : 'Save branding'}
          </button>
        </div>
        <StatusMessage state={brandingState} />
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '28rem' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Logo</span>
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          PNG or JPEG, up to 2 MB. Scanned for safety before it's shown anywhere.
        </span>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="Current organization logo"
            style={{
              height: '3rem',
              width: '3rem',
              objectFit: 'contain',
              borderRadius: '0.25rem',
              border: '1px solid var(--border, #ddd)',
            }}
          />
        ) : (
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            No logo set yet.
          </span>
        )}
        <form
          action={(formData) => {
            uploadAction(formData);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <input type="hidden" name="organizationId" value={organizationId} />
          <input
            ref={fileInputRef}
            type="file"
            name="logo"
            accept="image/png,image/jpeg"
            required
          />
          <button type="submit" className="btn btn-secondary" disabled={uploadPending}>
            {uploadPending ? 'Uploading…' : logoUrl ? 'Replace' : 'Upload'}
          </button>
        </form>
        <StatusMessage state={uploadState} />
        {logoUrl ? (
          <form action={removeAction}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <button type="submit" className="btn btn-secondary" disabled={removePending}>
              {removePending ? 'Removing…' : 'Remove logo'}
            </button>
          </form>
        ) : null}
        <StatusMessage state={removeState} />
      </div>
    </div>
  );
}

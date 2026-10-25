'use client';

import { useActionState, useRef, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { agencyBrand, contrast } from '../../../../lib/agency-brand';
import {
  type ActionState,
  removeLogoAction,
  updateBrandingAction,
  uploadLogoAction,
} from './actions';
import { AgencyBrandScope, AgencyMark } from './org-branding-header';

const INITIAL: ActionState = { ok: true, message: '' };
const HEX = /^#[0-9a-f]{6}$/i;
/** The least contrast against white that an accent may have (WCAG AA for normal text). */
const MIN_CONTRAST = 4.5;

/** Ready-made accents, every one readable against white, so a good choice is one click away. */
export const ACCENT_PRESETS: readonly { readonly name: string; readonly hex: string }[] = [
  { name: 'Teal', hex: '#087a68' },
  { name: 'Navy', hex: '#1f4e79' },
  { name: 'Indigo', hex: '#3f3d9b' },
  { name: 'Plum', hex: '#7a2f6b' },
  { name: 'Crimson', hex: '#a12a3a' },
  { name: 'Rust', hex: '#a14a12' },
  { name: 'Forest', hex: '#2f6b3a' },
  { name: 'Slate', hex: '#44546a' },
];

function StatusMessage({ state }: { readonly state: ActionState }) {
  return <FormMessage result={state} />;
}

/** Plain words about how readable an accent is against white. */
function readability(value: string): { readonly ok: boolean; readonly text: string } | null {
  if (!HEX.test(value)) return null;
  const ratio = contrast(value, '#ffffff');
  const shown = `${ratio.toFixed(1)} to 1`;
  return ratio >= MIN_CONTRAST
    ? { ok: true, text: `Readable on white (${shown}).` }
    : { ok: false, text: `Too light to read on white (${shown}). It needs at least 4.5 to 1.` };
}

/**
 * An agency's branding: name, accent colour and logo (Commercial V1 COM-04), with a live preview of how the
 * agency will look. The preview and everything it shows come from `lib/agency-brand.ts`, the same values the
 * workspace header uses, so what you see here is what travellers and your team see.
 */
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
  const [draftName, setDraftName] = useState(name);
  const [draftAccent, setDraftAccent] = useState(accentColor ?? '');
  const brand = agencyBrand({
    name: draftName.trim() || name,
    accentColor: HEX.test(draftAccent) ? draftAccent : null,
    logoUrl,
  });
  const check = readability(draftAccent);

  return (
    <div className="brand-settings">
      <section className="brand-preview" aria-label="How your agency will look">
        <p className="brand-preview-label">How It Looks</p>
        <AgencyBrandScope brand={brand} className="agency-hero agency-hero-preview">
          <AgencyMark brand={brand} size="lg" />
          <div className="agency-hero-text">
            <span className="eyebrow">Agency Workspace</span>
            <p className="page-title agency-preview-name">{brand.name}</p>
            <p className="agency-hero-attribution">Powered by VisaStack</p>
          </div>
        </AgencyBrandScope>
        <p className="muted brand-preview-note">
          Travellers see this on invitations from you. Your team sees it at the top of the
          workspace.
        </p>
      </section>

      <div className="brand-controls">
        <form action={brandingAction} className="brand-form">
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="field-row">
            <label className="field-label" htmlFor="brand-name">
              Agency Name
            </label>
            <input
              id="brand-name"
              className="input"
              type="text"
              name="name"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              maxLength={200}
              required
            />
          </div>

          <fieldset className="brand-accent">
            <legend className="field-label">Accent Colour</legend>
            <p className="muted brand-hint">
              Used for your mark and highlights. Pick one, or type a colour. It must be easy to read
              on white. Leave it empty to use the VisaStack green.
            </p>
            <div className="brand-swatches">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.hex}
                  type="button"
                  className="brand-swatch"
                  data-hex={preset.hex}
                  aria-label={preset.name}
                  aria-pressed={draftAccent.toLowerCase() === preset.hex}
                  onClick={() => setDraftAccent(preset.hex)}
                />
              ))}
            </div>
            <div className="brand-accent-inputs">
              <input
                id="brand-accent-picker"
                className="brand-picker"
                type="color"
                aria-label="Choose a colour"
                value={HEX.test(draftAccent) ? draftAccent : '#087a68'}
                onChange={(event) => setDraftAccent(event.target.value)}
              />
              <input
                id="brand-accent"
                className="input"
                type="text"
                name="accentColor"
                aria-label="Accent colour as a six-digit code"
                value={draftAccent}
                onChange={(event) => setDraftAccent(event.target.value.trim())}
                placeholder="#087a68"
                pattern="^#[0-9a-fA-F]{6}$"
                maxLength={7}
              />
            </div>
            {check ? (
              <output
                className={check.ok ? 'brand-check brand-check-ok' : 'brand-check brand-check-bad'}
              >
                {check.text}
              </output>
            ) : null}
          </fieldset>

          <div>
            <SubmitButton
              pending={brandingPending}
              idle="Save Branding"
              busy="Saving…"
              className="btn btn-primary"
            />
          </div>
          <StatusMessage state={brandingState} />
        </form>

        <section className="brand-logo" aria-label="Logo">
          <h3 className="brand-logo-title">Logo</h3>
          <p className="muted brand-hint">
            PNG or JPEG, up to 2 MB. A square or wide logo both work. It sits on a white tile, so a
            logo with a see-through background looks clean. It is checked to be a real PNG or JPEG
            image before anyone sees it.
          </p>
          <div className="brand-logo-current">
            <AgencyMark brand={brand} size="lg" />
            <span className="muted">
              {logoUrl ? 'Your logo, as it appears.' : 'No logo yet. Your initials show instead.'}
            </span>
          </div>
          <form
            action={(formData) => {
              uploadAction(formData);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
            className="brand-logo-upload"
          >
            <input type="hidden" name="organizationId" value={organizationId} />
            <input
              ref={fileInputRef}
              type="file"
              name="logo"
              accept="image/png,image/jpeg"
              required
              className="input"
              aria-label="Logo image (PNG or JPEG)"
            />
            <SubmitButton
              pending={uploadPending}
              idle={logoUrl ? 'Replace' : 'Upload'}
              busy="Uploading…"
              className="btn btn-secondary"
            />
          </form>
          <StatusMessage state={uploadState} />
          {logoUrl ? (
            <form action={removeAction}>
              <input type="hidden" name="organizationId" value={organizationId} />
              <SubmitButton
                pending={removePending}
                idle="Remove Logo"
                busy="Removing…"
                className="btn btn-secondary"
              />
            </form>
          ) : null}
          <StatusMessage state={removeState} />
        </section>
      </div>
    </div>
  );
}

'use client';
import { type InputHTMLAttributes, useState } from 'react';
import { useT } from '../../components/i18n-provider';
import { Icon } from '../../components/icons';
import { authCatalog } from '../../i18n/auth';
/** Visibility is local only; the existing named password field is unchanged. */
export function PasswordInput({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const t = useT(authCatalog);
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-password-input">
      <input {...props} aria-label={label} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        aria-label={
          visible
            ? t('auth.authPasswordInput.hidePassword')
            : t('auth.authPasswordInput.showPassword')
        }
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
      >
        <Icon name="eye" size={19} />
      </button>
    </div>
  );
}

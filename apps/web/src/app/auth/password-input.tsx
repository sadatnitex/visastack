'use client';
import { type InputHTMLAttributes, useState } from 'react';
import { Icon } from '../../components/icons';
/** Visibility is local only; the existing named password field is unchanged. */
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-password-input">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
      >
        <Icon name="eye" size={19} />
      </button>
    </div>
  );
}

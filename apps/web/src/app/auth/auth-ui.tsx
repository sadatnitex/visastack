import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '../../components/icons';
import { PasswordInput } from './password-input';

/** Shared pieces of the Neon Auth pages, so every form has the same labels, errors and spacing. */

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="auth-shell">
      <aside className="auth-introduction" aria-label="Your VisaStack account">
        <Link href="/" className="brand auth-brand">
          <span className="brand-mark" aria-hidden="true" />
          VisaStack
        </Link>
        <div className="auth-message">
          <p className="auth-kicker">Your record. Your terms.</p>
          <h2>
            A better way <br />
            to prepare for <br />
            <em>what's next.</em>
          </h2>
          <p>Keep your details together. Reuse what you need, and choose what you share.</p>
        </div>
        <p className="auth-footnote">
          <Icon name="shield" size={24} />
          You stay in control of your records and every suggestion you approve.
        </p>
      </aside>
      <div className="auth-form-panel">
        <h1 className="page-title">{title}</h1>
        {children}
        <nav className="auth-legal-links" aria-label="Account information">
          <Link href="/">Home</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </div>
    </section>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <output className="field-msg" style={{ display: 'block', marginBottom: '1rem' }}>
      {children}
    </output>
  );
}

export function ErrorLine({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p className="field-msg field-msg-err" id={id} role="alert">
      {message}
    </p>
  );
}

export function TextField(props: {
  id: string;
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password';
  autoComplete: string;
  required?: boolean;
  maxLength: number;
  minLength?: number;
  errorId?: string | undefined;
}) {
  const { id, name, label, type = 'text', errorId, ...rest } = props;
  return (
    <div className="field-row">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {type === 'password' ? (
        <PasswordInput
          id={id}
          name={name}
          className="input"
          aria-invalid={errorId ? true : undefined}
          aria-describedby={errorId}
          {...rest}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          className="input"
          aria-invalid={errorId ? true : undefined}
          aria-describedby={errorId}
          {...rest}
        />
      )}
    </div>
  );
}

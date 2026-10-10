import type { ReactNode } from 'react';
import { Icon } from '../../components/icons';

/** Shared pieces of the Neon Auth pages, so every form has the same labels, errors and spacing. */

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section container auth-shell">
      <aside className="auth-introduction" aria-label="Your VisaStack account">
        <p className="auth-kicker">Clarity. Control. Trust.</p>
        <h2>
          One profile.
          <br />
          <em>Every visa.</em>
        </h2>
        <p>Keep your details together. Reuse what you need, and choose what you share.</p>
        <ul>
          <li>
            <Icon name="user" size={20} />
            Your profile, kept in one place
          </li>
          <li>
            <Icon name="lock" size={20} />
            Documents private by default
          </li>
          <li>
            <Icon name="share" size={20} />
            Sharing you can stop at any time
          </li>
        </ul>
        <p className="auth-footnote">
          You stay in control of your records and every suggestion you approve.
        </p>
      </aside>
      <div className="auth-form-panel">
        <h1 className="page-title">{title}</h1>
        {children}
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
      <input
        id={id}
        name={name}
        type={type}
        className="input"
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        {...rest}
      />
    </div>
  );
}

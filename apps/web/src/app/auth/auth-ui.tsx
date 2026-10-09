import type { ReactNode } from 'react';

/** Shared pieces of the Neon Auth pages, so every form has the same labels, errors and spacing. */

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section container" style={{ maxWidth: '28rem' }}>
      <h1 className="page-title" style={{ marginBottom: '1.25rem' }}>
        {title}
      </h1>
      {children}
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

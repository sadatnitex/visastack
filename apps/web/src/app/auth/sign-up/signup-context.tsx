'use client';
import { useState } from 'react';
import { Icon } from '../../../components/icons';
/** Guidance only: one account may use both spaces; this grants no role. */
export function SignupContext() {
  const [intent, setIntent] = useState('traveller');
  return (
    <fieldset className="signup-context">
      <legend className="sr-only">How would you like to start?</legend>
      <div className="signup-context-options">
        {[
          { value: 'traveller', label: "I'm a traveller", icon: 'user' as const },
          { value: 'agency', label: "I'm an agency", icon: 'briefcase' as const },
        ].map((option) => (
          <label key={option.value} data-selected={intent === option.value}>
            <input
              type="radio"
              name="usageIntent"
              value={option.value}
              checked={intent === option.value}
              onChange={() => setIntent(option.value)}
            />
            <Icon name={option.icon} size={18} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <p className="card-body" aria-live="polite">
        {intent === 'agency'
          ? 'After confirming your email and signing in, create or choose your agency workspace from the account menu.'
          : 'After confirming your email and signing in, add a traveller to start their reusable profile.'}{' '}
        Your account can use both spaces.
      </p>
    </fieldset>
  );
}

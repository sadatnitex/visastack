'use client';

import { useState } from 'react';
import { Icon } from './icons';

/**
 * The two small example cards beside the example case on the home page, made to work.
 * Everything here is made-up and nothing is stored or sent: it only shows a visitor that a suggestion
 * waits for their say, and that sharing can be stopped. Without scripts the cards still read as an
 * example, with the same words as before.
 */
export function HeroExample() {
  const [suggestion, setSuggestion] = useState<'open' | 'approved' | 'rejected'>('open');
  const [sharing, setSharing] = useState<'on' | 'stopped'>('on');
  const touched = suggestion !== 'open' || sharing !== 'on';

  return (
    <>
      <aside className="land-example land-example-ai" aria-label="Example suggestion">
        <p className="land-example-kicker">
          <Icon name="activity" size={14} />
          Suggestion from your passport
        </p>
        <p className="land-example-line">
          Passport number <strong className="mono">X1234567</strong>
        </p>
        {suggestion === 'open' ? (
          <div className="land-example-actions">
            <button
              type="button"
              className="land-chip land-chip-yes"
              onClick={() => setSuggestion('approved')}
            >
              Approve
            </button>
            <button type="button" className="land-chip" onClick={() => setSuggestion('rejected')}>
              Reject
            </button>
          </div>
        ) : null}
        <output className="land-example-result">
          {suggestion === 'approved' ? 'Added to the example profile.' : null}
          {suggestion === 'rejected' ? 'Left out. You can still type it yourself.' : null}
        </output>
      </aside>

      <aside className="land-example land-example-share" aria-label="Example sharing">
        <p className="land-example-kicker">
          <Icon name="lock" size={14} />
          Shared with Sunrise Visa Services
        </p>
        <p className="land-example-line">
          {sharing === 'on' ? '3 items, until 30 Nov' : 'Sharing stopped.'}
        </p>
        <p className="land-example-note">You can stop this at any time</p>
        {sharing === 'on' ? (
          <div className="land-example-actions">
            <button type="button" className="land-chip" onClick={() => setSharing('stopped')}>
              Stop sharing
            </button>
          </div>
        ) : null}
        {touched ? (
          <div className="land-example-actions">
            <button
              type="button"
              className="land-chip"
              onClick={() => {
                setSuggestion('open');
                setSharing('on');
              }}
            >
              Start again
            </button>
          </div>
        ) : null}
      </aside>
    </>
  );
}

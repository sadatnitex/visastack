import Link from 'next/link';
import { Icon } from './icons';

/** Public explanation and a labelled illustration, never private sharing records. */
export function PublicTrustStory() {
  return (
    <section className="trust-story land-wrap" aria-labelledby="trust-story-title">
      <div className="trust-hero">
        <div>
          <div className="eyebrow">The Trust Model</div>
          <h1 id="trust-story-title">
            Your documents.
            <em>Your decisions.</em>
          </h1>
          <p>
            Your passport and personal records belong to you. Keep them organized, choose what you
            share, and review the history of your changes.
          </p>
          <a href="/app" className="btn btn-primary">
            <Icon name="plus" size={17} />
            Start with your own profile
          </a>
        </div>
        <aside className="trust-control" aria-label="Example of sharing permissions">
          <p className="trust-example-label">Illustration with made-up details</p>
          <div className="trust-window-head">
            <h2>Sharing Permissions</h2>
            <span className="trust-control-chip">You Choose</span>
          </div>
          <div className="trust-person">
            <span className="trust-avatar">
              <Icon name="user" size={20} />
            </span>
            <div>
              <b>Example Traveller</b>
              <small>Owner of this example file</small>
            </div>
            <span className="trust-control-chip">Your Records</span>
          </div>
          <div className="trust-divider" />
          <div className="trust-person">
            <span className="trust-avatar">
              <Icon name="building" size={20} />
            </span>
            <div>
              <b>Example Agency</b>
              <small>Selected items for a limited time</small>
            </div>
          </div>
          <div className="trust-selection">
            <span>
              <Icon name="check" size={15} />
              Passport summary
            </span>
            <span>
              <Icon name="check" size={15} />
              Confirmed itinerary
            </span>
            <span>
              <Icon name="lock" size={15} />
              Original files stay protected
            </span>
          </div>
          <p className="trust-revoke">Review, pause or end future access in your sharing page.</p>
        </aside>
      </div>
      <div className="trust-principles">
        <article className="card">
          <span className="trust-feature-icon">
            <Icon name="shield" size={24} />
          </span>
          <h2 className="card-title">Private by Design</h2>
          <p className="card-body">
            Your records belong to you. Choose the recipient, purpose, items and time limit for each
            sharing request.
          </p>
        </article>
        <article className="card">
          <span className="trust-feature-icon">
            <Icon name="eye" size={24} />
          </span>
          <h2 className="card-title">Know who can see what</h2>
          <p className="card-body">
            Access starts after acceptance. You can stop future access, but cannot erase copies
            already downloaded.
          </p>
        </article>
        <article className="card">
          <span className="trust-feature-icon">
            <Icon name="clipboard" size={24} />
          </span>
          <h2 className="card-title">A history you can review</h2>
          <p className="card-body">
            Changes are recorded as new versions. Review your history and request export or
            deletion, subject to legal retention.
          </p>
        </article>
        <article className="card">
          <span className="trust-feature-icon">
            <Icon name="check" size={24} />
          </span>
          <h2 className="card-title">AI suggests. You decide.</h2>
          <p className="card-body">
            A suggestion stays separate from a confirmed fact until you approve it. You can also
            enter details by hand.
          </p>
        </article>
      </div>
      <div className="trust-bottom">
        <span>Clear boundaries. Human control. No approval guarantees.</span>
        <Link href="/privacy">
          View privacy details <Icon name="arrow" size={16} />
        </Link>
      </div>
    </section>
  );
}

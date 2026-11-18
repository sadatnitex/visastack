import type { ReactNode } from 'react';
import { ExplainTip } from '../explain-tip';
import { DocumentPicture } from '../pictures/document-picture';

/** The colour a mark speaks in. Words always say the state too; colour is never the only signal. */
export type DocumentMarkTone = 'ok' | 'warn' | 'bad' | 'neutral';

/** One short state of the file (how it was checked, its dates, its safe copy). */
export interface DocumentMark {
  /** Stable key for the list, for example "safety" or "expiry". */
  readonly id: string;
  /** The state's name in Title Case, exactly as the rest of the product words it. */
  readonly label: string;
  /** One plain sentence that says what the state means, and nothing more than VisaStack knows. */
  readonly explain: string;
  readonly tone: DocumentMarkTone;
  /** Announce changes to this state politely (the processing state, which moves on its own). */
  readonly live?: boolean;
  /** Something that belongs right after the state's word, such as the link a Replaced file offers. */
  readonly after?: ReactNode;
}

export interface DocumentHeroCardProps {
  /** The document's name as the person sees it in the list. */
  readonly name: string;
  /** The kind in plain words (for example "Passport"), or null when it is not set. */
  readonly kind: string | null;
  /** The stored type key, used only to choose the drawing. */
  readonly docType: string | null;
  /** Short facts under the name, already formatted (for example "Updated 4 Nov 2026"). */
  readonly facts?: readonly string[];
  readonly marks: readonly DocumentMark[];
  /** The buttons that open or download the file; built by the page, which owns the server actions. */
  readonly actions?: ReactNode;
  /**
   * A real preview of the file, when one exists. VisaStack keeps no stored thumbnails yet, so the
   * page leaves this out and the drawing of the kind fills the card, which is never empty.
   */
  readonly preview?: ReactNode;
  /** The id the name heading carries, so buttons elsewhere can say which file they act on. */
  readonly nameId?: string;
}

/** The mark inside each state's ring: a tick, an exclamation or a short line. Shape, not colour, carries it. */
function MarkGlyph({ tone }: { readonly tone: DocumentMarkTone }) {
  return (
    <svg
      className="doc-hero-glyph"
      data-tone={tone}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="doc-hero-glyph-ring" cx="12" cy="12" r="10" />
      {tone === 'ok' ? (
        <path className="doc-hero-glyph-mark" d="M7.5 12.5l3 3 6-6.5" />
      ) : tone === 'neutral' ? (
        <path className="doc-hero-glyph-mark" d="M8 12h8" />
      ) : (
        <>
          <path className="doc-hero-glyph-mark" d="M12 7v6" />
          <path className="doc-hero-glyph-mark" d="M12 16.5v.5" />
        </>
      )}
    </svg>
  );
}

/**
 * Document detail, the front of the pass (WAL2, owner decision 17 Nov 2026: Preview Card First
 * with the Wallet Pass front as the hero). It shows what the file is and the state of its checks,
 * each state as a small picture with an Explain note and its word beside it. The dark pass look
 * lives in the picture stylesheet (ADR 0027); everything else on the page stays flat.
 *
 * It is presentation only: it never decides a state and never calls the server. The page passes
 * the words it already uses and the buttons it already has.
 */
export function DocumentHeroCard({
  name,
  kind,
  docType,
  facts = [],
  marks,
  actions,
  preview,
  nameId,
}: DocumentHeroCardProps) {
  return (
    <section className="doc-hero pic-pass" aria-labelledby={nameId}>
      <div className="doc-hero-top">
        <div className="doc-hero-art pic-glow">
          {preview ?? <DocumentPicture type={docType} size={64} generic="picture" depth />}
        </div>
        <div className="doc-hero-text">
          <h3 className="doc-hero-name" id={nameId} data-value="name">
            {name}
          </h3>
          <p className="doc-hero-kind" data-value="kind">
            {kind ?? 'Kind Not Set'}
          </p>
          {facts.length > 0 ? (
            <p className="doc-hero-facts" data-value="date">
              {facts.join(' · ')}
            </p>
          ) : null}
        </div>
      </div>
      {marks.length > 0 ? (
        <ul className="doc-hero-marks">
          {marks.map((mark) => (
            <li key={mark.id} className="doc-hero-mark" data-tone={mark.tone}>
              <ExplainTip label={mark.label} text={mark.explain}>
                <MarkGlyph tone={mark.tone} />
              </ExplainTip>
              {/* The word repeats the button's name, so it is hidden from screen readers. A live
              state is also announced from its own hidden region when it changes. */}
              <span className="doc-hero-mark-word" aria-hidden="true">
                {mark.label}
              </span>
              {mark.live ? (
                <span className="sr-only" aria-live="polite">
                  {mark.label}
                </span>
              ) : null}
              {mark.after ?? null}
            </li>
          ))}
        </ul>
      ) : null}
      {actions ? <div className="doc-hero-actions">{actions}</div> : null}
    </section>
  );
}

/**
 * The Recover a Payment form's reply (owner decision, 2 Nov 2026). Kept apart from the server
 * action file, which may export only async functions.
 */
export interface RecoverFormState {
  readonly ok: boolean;
  readonly message: string;
  /** The field a refusal is about, focused and marked. */
  readonly field?: string;
  /** What was typed, shown again after a refusal; empty once a payment was recovered. */
  readonly values?: Readonly<Record<string, string>>;
  /**
   * New with every reply: the boxes are drawn again from `values`, so the browser's reset after a
   * reply never empties what was typed.
   */
  readonly replyId?: string;
}

export const RECOVER_NO_REPLY: RecoverFormState = { ok: true, message: '' };

/** The form's fields, in order. */
export const RECOVER_FIELDS = ['code', 'planKey', 'transactionId'] as const;

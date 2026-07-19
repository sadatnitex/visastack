/**
 * A minimal, dependency-free `Result` type.
 *
 * The Universal Core never throws for expected, recoverable conditions —
 * it returns an explicit `Result`. This makes the "no silent mutation" and
 * "recoverable failures" guarantees from the PRD enforceable at the type
 * level: callers cannot ignore the failure branch.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

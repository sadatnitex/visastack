/**
 * Shows a stored code exactly as saved, in small secondary text, for the few places where staff
 * need it to investigate (the audit log). Everywhere else a person reads a plain label from
 * `lib/labels.ts`; use this component only when the exact code is the point.
 */
export function ExactCode({ value }: { readonly value: string }) {
  return (
    <>
      <br />
      <span className="muted mono">{value}</span>
    </>
  );
}

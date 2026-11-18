import type { ReactNode } from 'react';

/** R4 STAND-IN for the shared kit's RiseIn (R1-kit-contract.md): plain wrapper, no motion. Deleted at the R4 turn. */
export function RiseIn({ children }: { readonly children: ReactNode; readonly delay?: number }) {
  return <div className="r4s-rise">{children}</div>;
}

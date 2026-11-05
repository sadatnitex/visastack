import type { AnchorHTMLAttributes } from 'react';

/** The fixtures draw plain links; nothing is ever waiting. */
export function useLinkStatus(): { readonly pending: boolean } {
  return { pending: false };
}

export default function FixtureLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}

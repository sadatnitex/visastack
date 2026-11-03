import type { ReactNode } from 'react';

/** The page gutter for Start a Trip and its loading screen: the page has no frame of its own. */
export default function StartTripLayout({ children }: { readonly children: ReactNode }) {
  return <section className="section container">{children}</section>;
}

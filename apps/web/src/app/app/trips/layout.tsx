import type { ReactNode } from 'react';

/**
 * The page gutter for every Group Trips page (the list, one trip and New Group Trip, and their
 * loading screens). These pages return a header and cards with no frame of their own, so without
 * this their text and buttons ran to the edge of the window beside the sidebar.
 */
export default function TripsLayout({ children }: { readonly children: ReactNode }) {
  return <section className="section container">{children}</section>;
}

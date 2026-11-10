'use client';

import { type ReactNode, createContext, useContext } from 'react';

const ShareOrigins = createContext<readonly string[]>([]);

/**
 * Tells the screens below which address is VisaStack's own, so a WhatsApp message can carry only a
 * link that belongs to VisaStack. The address comes from the server, from the same place that makes
 * every invitation and request link, so the two always agree (no list to keep in step by hand).
 */
export function ShareOriginsProvider({
  origin,
  children,
}: {
  readonly origin: string;
  readonly children: ReactNode;
}) {
  return <ShareOrigins.Provider value={[origin]}>{children}</ShareOrigins.Provider>;
}

export function useShareOrigins(): readonly string[] {
  return useContext(ShareOrigins);
}

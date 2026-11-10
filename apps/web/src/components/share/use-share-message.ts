'use client';

import { useMemo } from 'react';
import { type ShareInput, type ShareMessage, composeShareMessage } from '../../lib/whatsapp-link';
import { useShareOrigins } from './share-origins';

/**
 * A checked share message for a client screen, or null when the checks refuse it (or the page has
 * no VisaStack address to check links against). The caller then shows no WhatsApp action. The
 * input must be plain data (strings and lists), because it is compared by value.
 */
export function useShareMessage(input: ShareInput): ShareMessage | null {
  const origins = useShareOrigins();
  const key = JSON.stringify({ input, origins });
  return useMemo(() => {
    const parsed = JSON.parse(key) as { input: ShareInput; origins: string[] };
    const result = composeShareMessage(parsed.input, { allowedOrigins: parsed.origins });
    return result.ok ? result.message : null;
  }, [key]);
}

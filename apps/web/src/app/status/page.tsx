import type { Metadata } from 'next';
import { StatusClient } from './status-client';

export const metadata: Metadata = { title: 'What Works Today' };

/** The public status page. The page itself is a server component so it can name itself; the live checks run in the browser (`status-client.tsx`). */
export default function StatusPage() {
  return <StatusClient />;
}

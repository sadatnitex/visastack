import {
  aiConnectorEnabled,
  discoveryJson,
  notFound,
  protectedResourceMetadata,
} from '../../../lib/ai-connector';

export const dynamic = 'force-dynamic';

/** RFC 9728 metadata for the AI context address, also served at the root path. */
export function GET(): Response {
  if (!aiConnectorEnabled()) return notFound();
  return discoveryJson(protectedResourceMetadata());
}

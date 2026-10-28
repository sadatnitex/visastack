import {
  aiConnectorEnabled,
  discoveryJson,
  notFound,
  protectedResourceMetadata,
} from '../../../../lib/ai-connector';

export const dynamic = 'force-dynamic';

/** RFC 9728 metadata at the path-specific address for the AI context route (`/mcp`). */
export function GET(): Response {
  if (!aiConnectorEnabled()) return notFound();
  return discoveryJson(protectedResourceMetadata());
}

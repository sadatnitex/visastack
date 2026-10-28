import {
  aiConnectorEnabled,
  authorizationServerMetadata,
  discoveryJson,
  notFound,
} from '../../../lib/ai-connector';

export const dynamic = 'force-dynamic';

/** RFC 8414 discovery for the AI connector's sign-in (ADR 0021 section 2). */
export function GET(): Response {
  if (!aiConnectorEnabled()) return notFound();
  return discoveryJson(authorizationServerMetadata());
}

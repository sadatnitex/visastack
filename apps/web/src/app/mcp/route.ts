import { handleMcpPost, mcpMethodNotAllowed } from '../../lib/mcp-endpoint';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Claude and ChatGPT wait about 10 seconds for an answer; a tool call is a few database reads.
export const maxDuration = 10;

/** The AI context address (ADR 0021): stateless Model Context Protocol over HTTP, POST only. */
export function POST(request: Request): Promise<Response> {
  return handleMcpPost(request);
}

export function GET(): Response {
  return mcpMethodNotAllowed();
}

export function DELETE(): Response {
  return mcpMethodNotAllowed();
}

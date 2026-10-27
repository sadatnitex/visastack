import { handleTokenRequest } from '../../../lib/oauth-endpoints';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export function POST(request: Request): Promise<Response> {
  return handleTokenRequest(request);
}

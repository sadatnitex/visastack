import { type NextRequest, NextResponse } from 'next/server';

/**
 * AI Settings moved into the one AI area (S28): the providers, their data terms and AI apps are
 * sections of /app/admin/ai now, beside AI Features. Old links and bookmarks land there with a
 * permanent redirect. Nothing else is read or carried over from the old address.
 */
export function GET(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL('/app/admin/ai', request.url), 308);
}

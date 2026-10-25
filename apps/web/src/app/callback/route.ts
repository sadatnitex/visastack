import { type NextRequest, NextResponse } from 'next/server';

/**
 * The old sign-in provider's return address. Sign-in is Neon Auth only now, so any old link that
 * still lands here goes to the sign-in page; no code is exchanged.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return NextResponse.redirect(new URL('/auth/sign-in', request.url));
}

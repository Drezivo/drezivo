import { NextResponse } from 'next/server';

/**
 * Readiness probe only. This route MUST NEVER perform a business write —
 * Drezivo-TRD.md §1: "Do not duplicate business writes in Next.js route
 * handlers." It reports that the Next.js server process itself is up; it
 * intentionally does not check downstream API/database health, since a
 * healthy Next.js process that can't reach the API should still be able to
 * serve a graceful degraded page rather than fail its own liveness check.
 */
export function GET() {
  return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}

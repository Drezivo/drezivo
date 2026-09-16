import { NextResponse } from "next/server";

// Readiness probe only. NEVER add a business write here — TRD §1 is explicit that this
// Next.js app does not duplicate business writes in route handlers; every mutation goes
// through the Express API via lib/api-client.ts.
export function GET() {
  return NextResponse.json({ status: "ok" satisfies "ok" });
}

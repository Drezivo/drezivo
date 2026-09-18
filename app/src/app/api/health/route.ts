import { NextResponse } from "next/server";

// Readiness probe only. Business mutations belong to the backend boundary, not this route.
export function GET() {
  return NextResponse.json({ status: "ok" satisfies "ok" });
}

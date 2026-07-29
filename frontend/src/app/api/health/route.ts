import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe for the web app. See docs/operations/monitoring-and-observability.md. */
export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "frontend",
    timestamp: new Date().toISOString(),
  });
}

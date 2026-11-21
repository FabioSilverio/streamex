import { NextResponse } from "next/server";
import { fetchAllLiveStatuses, resolveCredentials } from "@/lib/stream-apis";
import type { FollowedChannel } from "@/types/streamex";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const started = performance.now();
  try {
    const body = (await req.json()) as { channels?: FollowedChannel[] };
    const channels = Array.isArray(body.channels) ? body.channels.slice(0, 500) : [];
    const creds = resolveCredentials(req.headers);

    const { statuses, apiHealth } = await fetchAllLiveStatuses(channels, creds);
    const latencyMs = Math.max(1, Math.round(performance.now() - started));

    return NextResponse.json(
      {
        statuses,
        latencyMs,
        checkedAt: Date.now(),
        apiHealth,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to check live status",
        details: error instanceof Error ? error.message : "unknown",
      },
      { status: 500 },
    );
  }
}

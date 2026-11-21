import { NextResponse } from "next/server";
import { fetchUnifiedFeed, resolveCredentials } from "@/lib/stream-apis";
import type { FollowedChannel } from "@/types/streamex";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      channels?: FollowedChannel[];
      perChannelLimit?: number;
    };
    const channels = Array.isArray(body.channels) ? body.channels.slice(0, 500) : [];
    const perChannelLimit =
      typeof body.perChannelLimit === "number" && Number.isFinite(body.perChannelLimit)
        ? Math.min(20, Math.max(1, Math.floor(body.perChannelLimit)))
        : undefined;
    const creds = resolveCredentials(req.headers);

    const { items, apiHealth } = await fetchUnifiedFeed(channels, creds, perChannelLimit);

    return NextResponse.json(
      {
        items,
        fetchedAt: Date.now(),
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
        error: "Failed to load unified feed",
        details: error instanceof Error ? error.message : "unknown",
      },
      { status: 500 },
    );
  }
}

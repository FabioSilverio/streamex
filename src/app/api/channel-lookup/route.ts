import { NextResponse } from "next/server";
import { lookupSingleChannel, resolveCredentials } from "@/lib/stream-apis";
import type { Platform } from "@/types/streamex";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { platform?: Platform; query?: string };
    const platform: Platform =
      body.platform === "kick" || body.platform === "youtube" ? body.platform : "twitch";
    const query = (body.query || "").trim();

    if (!query) {
      return NextResponse.json({ error: "Query required" }, { status: 400 });
    }

    const creds = resolveCredentials(req.headers);
    const result = await lookupSingleChannel(platform, query, creds);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lookup failed" },
      { status: 500 },
    );
  }
}

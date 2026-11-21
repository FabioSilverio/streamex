import { NextResponse, type NextRequest } from "next/server";
import { readAccount, serverCreds, toPublic } from "@/lib/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(
    {
      twitch: toPublic(readAccount(req, "twitch")),
      kick: toPublic(readAccount(req, "kick")),
      twitchLoginAvailable: Boolean(serverCreds("twitch")),
      kickLoginAvailable: Boolean(serverCreds("kick")),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

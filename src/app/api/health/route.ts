import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      serverHasTwitchEnv: Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET),
      serverHasKickEnv: Boolean(process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET),
      timestamp: Date.now(),
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}

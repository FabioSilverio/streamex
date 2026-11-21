import { NextResponse, type NextRequest } from "next/server";
import {
  clearAccount,
  ensureFresh,
  fetchTwitchFollows,
  readAccount,
  serverCreds,
  writeAccount,
} from "@/lib/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const stored = readAccount(req, "twitch");
  const creds = serverCreds("twitch");
  if (!stored || !creds) {
    return NextResponse.json({ error: "not_connected" }, { status: 401 });
  }

  const fresh = await ensureFresh(stored);
  if (!fresh) {
    const res = NextResponse.json({ error: "session_expired" }, { status: 401 });
    clearAccount(req, res, "twitch");
    return res;
  }

  try {
    const channels = await fetchTwitchFollows(fresh.account, creds.id);
    const res = NextResponse.json(
      { channels, syncedAt: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
    if (fresh.refreshed) writeAccount(req, res, fresh.account);
    return res;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    const res = NextResponse.json({ error: msg }, { status: msg.endsWith("401") ? 401 : 502 });
    if (msg.endsWith("401")) clearAccount(req, res, "twitch");
    return res;
  }
}

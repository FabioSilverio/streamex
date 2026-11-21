import { NextResponse, type NextRequest } from "next/server";
import { clearAccount, readAccount, serverCreds } from "@/lib/oauth";
import type { AuthPlatform as Platform } from "@/types/streamex";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { platform?: Platform };
  const platform: Platform = body.platform === "kick" ? "kick" : "twitch";
  const account = readAccount(req, platform);
  const creds = serverCreds(platform);

  // Best-effort token revocation
  if (account && creds && platform === "twitch") {
    await fetch("https://id.twitch.tv/oauth2/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: creds.id, token: account.accessToken }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);
  }

  const res = NextResponse.json({ ok: true });
  clearAccount(req, res, platform);
  return res;
}

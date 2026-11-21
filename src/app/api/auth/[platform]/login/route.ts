import { NextResponse, type NextRequest } from "next/server";
import {
  KICK_SCOPES,
  TWITCH_SCOPES,
  makeState,
  redirectUri,
  serverCreds,
  writeState,
} from "@/lib/oauth";
import type { AuthPlatform as Platform } from "@/types/streamex";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/auth/[platform]/login">) {
  const { platform: raw } = await ctx.params;
  if (raw !== "twitch" && raw !== "kick") {
    return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  }
  const platform = raw as Platform;
  const creds = serverCreds(platform);
  if (!creds) {
    return NextResponse.redirect(
      new URL(`/?auth_error=${platform}_missing_env`, req.nextUrl.origin),
    );
  }

  const { payload, challenge } = makeState(platform, platform === "kick");
  const params = new URLSearchParams({
    client_id: creds.id,
    redirect_uri: redirectUri(req, platform),
    response_type: "code",
    scope: (platform === "twitch" ? TWITCH_SCOPES : KICK_SCOPES).join(" "),
    state: payload.state,
  });
  if (challenge) {
    params.set("code_challenge", challenge);
    params.set("code_challenge_method", "S256");
  }
  if (platform === "twitch") params.set("force_verify", "false");

  const authorizeUrl =
    platform === "twitch"
      ? `https://id.twitch.tv/oauth2/authorize?${params}`
      : `https://id.kick.com/oauth/authorize?${params}`;

  const res = NextResponse.redirect(authorizeUrl);
  writeState(req, res, payload);
  return res;
}

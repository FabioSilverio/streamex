import { NextResponse, type NextRequest } from "next/server";
import {
  consumeState,
  exchangeCode,
  fetchKickSelf,
  fetchTwitchSelf,
  redirectUri,
  serverCreds,
  writeAccount,
} from "@/lib/oauth";
import type { AuthPlatform as Platform } from "@/types/streamex";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/auth/[platform]/callback">) {
  const { platform: raw } = await ctx.params;
  if (raw !== "twitch" && raw !== "kick") {
    return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  }
  const platform = raw as Platform;
  const home = new URL("/", req.nextUrl.origin);
  const fail = (reason: string) => {
    home.searchParams.set("auth_error", `${platform}_${reason}`);
    const res = NextResponse.redirect(home);
    consumeState(req, res, platform, null);
    return res;
  };

  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return fail("denied");

  const creds = serverCreds(platform);
  if (!creds) return fail("missing_env");

  const res = NextResponse.redirect(home);
  const state = consumeState(req, res, platform, sp.get("state"));
  const code = sp.get("code");
  if (!state || !code) return fail("state");

  const token = await exchangeCode(platform, code, redirectUri(req, platform), state.verifier);
  if (!token?.access_token) return fail("token");

  const expiresAt = Date.now() + (token.expires_in ?? 3600) * 1000;

  if (platform === "twitch") {
    const me = await fetchTwitchSelf(token.access_token, creds.id);
    if (!me) return fail("profile");
    writeAccount(req, res, {
      platform,
      userId: me.id,
      login: me.login,
      displayName: me.display_name,
      avatarUrl: me.profile_image_url,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt,
    });
  } else {
    const me = await fetchKickSelf(token.access_token);
    if (!me) return fail("profile");
    writeAccount(req, res, {
      platform,
      userId: String(me.user_id),
      login: me.slug,
      displayName: me.name,
      avatarUrl: me.profile_picture || "",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt,
    });
  }

  home.searchParams.set("connected", platform);
  res.headers.set("Location", home.toString());
  return res;
}

import { NextResponse, type NextRequest } from "next/server";

/**
 * Twitch and Kick both send the user back to the site root (`/?code=…&state=…`), because that's
 * the redirect URL registered in their app settings. Route it to the right callback using the
 * platform stored in the short-lived state cookie set at login. The callback re-validates `state`.
 */
export function proxy(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (!sp.has("state") || !(sp.has("code") || sp.has("error"))) return NextResponse.next();

  let platform = "kick";
  const raw = req.cookies.get("sx_oauth_state")?.value;
  if (raw) {
    try {
      const json = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
      const parsed = JSON.parse(json) as { platform?: string };
      if (parsed.platform === "twitch") platform = "twitch";
    } catch {
      // fall through to kick; the callback will reject a bad state anyway
    }
  }

  const url = req.nextUrl.clone();
  url.pathname = `/api/auth/${platform}/callback`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: "/",
};

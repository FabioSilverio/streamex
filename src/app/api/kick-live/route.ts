import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Kick live HLS master playlist, proxied. The master manifest on Kick's CDN has no CORS header
 * (the variant playlists and segments do), so the browser can't load it directly. We fetch a
 * fresh, short-lived master here and return it as-is; its variant URLs are absolute, so the
 * player streams the video straight from Kick's CDN.
 */
export async function GET(req: NextRequest) {
  const slug = (req.nextUrl.searchParams.get("slug") || "").toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }

  const meta = await fetch(`https://kick.com/api/v2/channels/${slug}/livestream`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  }).catch(() => null);
  const json = meta?.ok
    ? ((await meta.json().catch(() => null)) as { data?: { playback_url?: string } | null } | null)
    : null;
  const playbackUrl = json?.data?.playback_url;
  if (!playbackUrl) return NextResponse.json({ error: "offline" }, { status: 404 });

  const master = await fetch(playbackUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  }).catch(() => null);
  if (!master?.ok) return NextResponse.json({ error: "stream unavailable" }, { status: 502 });

  return new NextResponse(await master.text(), {
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl",
      // tokens inside expire in ~10 min; a short shared cache spares Kick on repeated hovers
      "Cache-Control": "public, s-maxage=30, max-age=0",
    },
  });
}

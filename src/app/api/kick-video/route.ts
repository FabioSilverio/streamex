import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Resolve a Kick VOD's HLS source by UUID. Feed items carry it already; this covers VODs opened
 * from "Continuar assistindo" (or synced by the extension) that are no longer in the feed.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const res = await fetch(`https://kick.com/api/v1/video/${id}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res?.ok) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data = (await res.json().catch(() => null)) as {
    source?: string;
    livestream?: { duration?: number; session_title?: string; thumbnail?: string };
  } | null;
  if (!data?.source) return NextResponse.json({ error: "no source" }, { status: 404 });

  return NextResponse.json(
    {
      hlsUrl: data.source,
      durationSeconds: Math.round((data.livestream?.duration ?? 0) / 1000),
      title: data.livestream?.session_title ?? null,
    },
    { headers: { "Cache-Control": "public, s-maxage=600" } },
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { getRedis, resolveIdentity, syncProfile } from "@/lib/sync-store";
import { sanitizeSyncState } from "@/lib/sync-merge";

export const dynamic = "force-dynamic";

/** Request bodies above this are refused (Vercel's hard limit is 4.5 MB). */
const MAX_BODY_BYTES = 1_000_000;

/**
 * Two-way sync: the device sends everything it has, the server merges it with the stored
 * profile (per item, newest wins), saves, and returns the merged result for the device to apply.
 */
export async function POST(req: NextRequest) {
  if (!getRedis()) {
    return NextResponse.json({ error: "sync_unavailable" }, { status: 503 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const res = NextResponse.json({});
  const identity = await resolveIdentity(req, res);
  if (!identity) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const merged = await syncProfile(identity, sanitizeSyncState(body));
  const out = NextResponse.json(
    { state: merged, syncedAt: Date.now(), account: identity.twitchId ? "twitch" : "kick" },
    { headers: { "Cache-Control": "no-store" } },
  );
  // carry over refreshed-token cookies set during identity resolution
  for (const c of res.cookies.getAll()) out.cookies.set(c);
  return out;
}

import type { FeedItem, FollowedChannel, LiveChannelStatus } from "@/types/streamex";
import { makeAvatarFallback } from "@/lib/utils";

/**
 * YouTube without an API key:
 * - channel page  → channel id, name, avatar (resolving @handles and URLs)
 * - /channel/<id>/live → whether it's live right now (canonical points at the live video)
 * - RSS feed      → the 15 latest uploads with view counts
 * YouTube can't take a request every 2s per channel, so live status is cached for 60s and
 * uploads for 10 minutes.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
// Skip the EU cookie-consent interstitial.
const HEADERS = { "User-Agent": UA, "Accept-Language": "en-US", Cookie: "CONSENT=YES+1; SOCS=CAI" };

const LIVE_TTL_MS = 60_000;
const VIDEOS_TTL_MS = 10 * 60_000;

async function getHtml(url: string, timeout = 6000) {
  const res = await fetch(url, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  }).catch(() => null);
  return res?.ok ? res.text() : null;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\u0026/g, "&");

/** Accepts a channel URL, @handle, /c/ or /user/ name, or a UC… id. */
export async function resolveYoutubeChannel(
  raw: string,
): Promise<{ id: string; name: string; avatarUrl: string; handle?: string } | null> {
  const q = raw.trim();
  let url: string;
  const idMatch = q.match(/(UC[\w-]{22})/);
  if (idMatch) url = `https://www.youtube.com/channel/${idMatch[1]}`;
  else if (/youtube\.com\//i.test(q)) url = q.startsWith("http") ? q : `https://${q}`;
  else url = `https://www.youtube.com/@${q.replace(/^@/, "")}`;

  const html = await getHtml(url);
  if (!html) return null;
  const id =
    html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] ||
    html.match(
      /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    )?.[1];
  if (!id) return null;
  const name = decode(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || id);
  const avatarUrl = decode(html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || "");
  const handle = html.match(/"vanityChannelUrl":"https?:\/\/www\.youtube\.com\/(@[^"]+)"/)?.[1];
  return { id, name, avatarUrl, handle };
}

interface LiveInfo {
  videoId: string | null;
  title: string;
  viewers: number;
  category: string;
  at: number;
}
const liveCache = new Map<string, LiveInfo>();

/** "3.3K watching" → 3300 */
function parseWatching(text: string | undefined): number {
  const m = text?.match(/([\d.,]+)\s*([KkMm]?)/);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, ""));
  const mult = /k/i.test(m[2]) ? 1_000 : /m/i.test(m[2]) ? 1_000_000 : 1;
  return Math.round(n * mult);
}

/**
 * Live status comes from the channel's "Live" tab (/streams): every broadcast that is on air
 * carries a LIVE badge. (/channel/<id>/live would be simpler, but YouTube serves datacenter IPs —
 * like Vercel's — a "confirm you're not a bot" version of it without the video link.)
 */
async function getLiveInfo(channelId: string): Promise<LiveInfo> {
  const hit = liveCache.get(channelId);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit;
  const html = await getHtml(`https://www.youtube.com/channel/${channelId}/streams`, 6000);
  let info: LiveInfo = { videoId: null, title: "", viewers: 0, category: "", at: Date.now() };
  if (html) {
    const live = html
      .split('"lockupViewModel"')
      .slice(1)
      .find((item) => item.includes("THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE"));
    const videoId = live?.match(/"contentId":"([\w-]{11})"/)?.[1];
    if (live && videoId) {
      info = {
        videoId,
        title: decode(live.match(/"title":\{"content":"([^"]+)"/)?.[1] || ""),
        viewers: parseWatching(live.match(/"content":"([^"]*watching)"/)?.[1]),
        category: "",
        at: Date.now(),
      };
    }
  } else if (hit) {
    // Network hiccup: keep the last known state rather than flipping the channel offline.
    info = { ...hit, at: Date.now() - LIVE_TTL_MS / 2 };
  }
  liveCache.set(channelId, info);
  return info;
}

export async function fetchYoutubeLiveStatuses(
  channels: FollowedChannel[],
): Promise<LiveChannelStatus[]> {
  const now = Date.now();
  return Promise.all(
    channels.map(async (ch) => {
      const live = await getLiveInfo(ch.slug);
      return {
        id: ch.id,
        platform: "youtube" as const,
        slug: ch.slug,
        displayName: ch.displayName,
        avatarUrl: ch.avatarUrl || makeAvatarFallback(ch.displayName, "youtube"),
        isLive: Boolean(live.videoId),
        title: live.title,
        category: live.category,
        viewerCount: live.viewers,
        startedAt: null,
        thumbnailUrl: live.videoId
          ? `https://i.ytimg.com/vi/${live.videoId}/hqdefault_live.jpg?t=${Math.floor(now / 60000)}`
          : "",
        streamId: live.videoId,
        source: "public" as const,
        checkedAt: now,
      };
    }),
  );
}

const videosCache = new Map<string, { items: FeedItem[]; at: number }>();

export async function fetchYoutubeVideos(
  ch: FollowedChannel,
  avatar: string,
  limit = 6,
): Promise<FeedItem[]> {
  const hit = videosCache.get(ch.slug);
  if (hit && Date.now() - hit.at < VIDEOS_TTL_MS) return hit.items.slice(0, limit);
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.slug}`, {
    headers: { "User-Agent": UA },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res?.ok) return (hit?.items ?? []).slice(0, limit);
  const xml = await res.text();
  const items: FeedItem[] = [];
  for (const entry of xml.split("<entry>").slice(1, 16)) {
    const videoId = entry.match(/<yt:videoId>([^<]+)/)?.[1];
    if (!videoId) continue;
    const isShort = /\/shorts\//.test(entry);
    items.push({
      id: `youtube:vod:${videoId}`,
      platform: "youtube",
      channelSlug: ch.slug,
      channelName: ch.displayName,
      channelAvatar: avatar,
      type: "vod",
      title: decode(entry.match(/<title>([^<]+)/)?.[1] || "Vídeo"),
      category: isShort ? "Short" : "YouTube",
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      durationSeconds: 0,
      viewCount: Number(entry.match(/<media:statistics views="(\d+)"/)?.[1] || 0),
      createdAt: entry.match(/<published>([^<]+)/)?.[1] || new Date().toISOString(),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
      tags: ["YouTube"],
    });
  }
  videosCache.set(ch.slug, { items, at: Date.now() });
  return items.slice(0, limit);
}

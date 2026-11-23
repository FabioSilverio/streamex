import type {
  ApiHealth,
  FeedItem,
  FollowedChannel,
  LiveChannelStatus,
  Platform,
} from "@/types/streamex";
import { channelUrl, makeAvatarFallback, parseTwitchDuration } from "@/lib/utils";
import { fetchYoutubeLiveStatuses, fetchYoutubeVideos, resolveYoutubeChannel } from "@/lib/youtube";

export interface ResolvedCredentials {
  twitchClientId?: string;
  twitchClientSecret?: string;
  kickClientId?: string;
  kickClientSecret?: string;
}

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

interface TwitchUserMeta {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string;
  cachedAt: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
const twitchUserCache = new Map<string, TwitchUserMeta>();
const USER_CACHE_TTL_MS = 5 * 60 * 1000;

export function resolveCredentials(headers: Headers): ResolvedCredentials {
  const twitchClientId =
    headers.get("x-twitch-client-id")?.trim() || process.env.TWITCH_CLIENT_ID?.trim() || undefined;
  const twitchClientSecret =
    headers.get("x-twitch-client-secret")?.trim() ||
    process.env.TWITCH_CLIENT_SECRET?.trim() ||
    undefined;
  const kickClientId =
    headers.get("x-kick-client-id")?.trim() || process.env.KICK_CLIENT_ID?.trim() || undefined;
  const kickClientSecret =
    headers.get("x-kick-client-secret")?.trim() ||
    process.env.KICK_CLIENT_SECRET?.trim() ||
    undefined;

  return { twitchClientId, twitchClientSecret, kickClientId, kickClientSecret };
}

async function getTwitchAppToken(clientId: string, clientSecret: string): Promise<string | null> {
  const key = `twitch:${clientId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    });

    const res = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;

    tokenCache.set(key, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    return data.access_token;
  } catch {
    return null;
  }
}

async function getKickAppToken(clientId: string, clientSecret: string): Promise<string | null> {
  const key = `kick:${clientId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    });

    const res = await fetch("https://id.kick.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;

    tokenCache.set(key, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    return data.access_token;
  } catch {
    return null;
  }
}

async function getTwitchUsersOfficial(
  logins: string[],
  clientId: string,
  token: string,
): Promise<Map<string, TwitchUserMeta>> {
  const result = new Map<string, TwitchUserMeta>();
  const missing: string[] = [];
  const now = Date.now();

  for (const login of logins) {
    const lower = login.toLowerCase();
    const cached = twitchUserCache.get(lower);
    if (cached && now - cached.cachedAt < USER_CACHE_TTL_MS) {
      result.set(lower, cached);
    } else {
      missing.push(lower);
    }
  }

  for (const group of chunk(missing, 100)) {
    const qs = group.map((l) => `login=${encodeURIComponent(l)}`).join("&");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`https://api.twitch.tv/helix/users?${qs}`, {
          headers: {
            "Client-Id": clientId,
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const json = (await res.json()) as {
            data?: Array<{
              id: string;
              login: string;
              display_name: string;
              profile_image_url: string;
            }>;
          };
          for (const u of json.data ?? []) {
            const meta: TwitchUserMeta = {
              id: u.id,
              login: u.login.toLowerCase(),
              displayName: u.display_name,
              avatarUrl: u.profile_image_url,
              cachedAt: now,
            };
            twitchUserCache.set(meta.login, meta);
            result.set(meta.login, meta);
          }
          break;
        }
        if (res.status < 500 && res.status !== 429) break;
      } catch {
        // Retry once on transient timeout/network hiccup
      }
    }
  }

  return result;
}

interface IvrTwitchUser {
  id?: string;
  login?: string;
  displayName?: string;
  logo?: string;
  stream?: {
    id?: string;
    title?: string;
    viewersCount?: number;
    createdAt?: string;
    game?: { displayName?: string };
  } | null;
}

async function fetchTwitchLiveStatuses(
  channels: FollowedChannel[],
  creds: ResolvedCredentials,
): Promise<{ statuses: LiveChannelStatus[]; health: ApiHealth["twitch"] }> {
  const now = Date.now();
  if (channels.length === 0) {
    return {
      statuses: [],
      health: creds.twitchClientId && creds.twitchClientSecret ? "official" : "public",
    };
  }

  const logins = channels.map((c) => c.slug.toLowerCase());
  const previewBucket = Math.floor(now / 15_000);

  // Tier 1: Official Twitch Helix API (single ultra-fast batch call)
  if (creds.twitchClientId && creds.twitchClientSecret) {
    const token = await getTwitchAppToken(creds.twitchClientId, creds.twitchClientSecret);
    if (token) {
      try {
        const clientId = creds.twitchClientId;
        const [streamResponses, userMap] = await Promise.all([
          Promise.all(
            chunk(logins, 100).map((group) =>
              fetch(
                `https://api.twitch.tv/helix/streams?first=100&${group
                  .map((l) => `user_login=${encodeURIComponent(l)}`)
                  .join("&")}`,
                {
                  headers: { "Client-Id": clientId, Authorization: `Bearer ${token}` },
                  cache: "no-store",
                  signal: AbortSignal.timeout(5000),
                },
              ),
            ),
          ),
          getTwitchUsersOfficial(logins, clientId, token),
        ]);

        if (streamResponses.every((r) => r.ok)) {
          const pages = (await Promise.all(streamResponses.map((r) => r.json()))) as Array<{
            data?: Array<{
              id: string;
              user_login: string;
              user_name: string;
              game_name: string;
              title: string;
              viewer_count: number;
              started_at: string;
              thumbnail_url: string;
            }>;
          }>;
          const liveMap = new Map(
            pages.flatMap((p) => p.data ?? []).map((s) => [s.user_login.toLowerCase(), s]),
          );

          const statuses: LiveChannelStatus[] = channels.map((ch) => {
            const lower = ch.slug.toLowerCase();
            const live = liveMap.get(lower);
            const meta = userMap.get(lower);
            const thumb = live?.thumbnail_url
              ? `${live.thumbnail_url.replace("{width}", "640").replace("{height}", "360")}?t=${previewBucket}`
              : "";

            return {
              id: ch.id,
              platform: "twitch",
              slug: lower,
              displayName: live?.user_name || meta?.displayName || ch.displayName,
              avatarUrl: meta?.avatarUrl || ch.avatarUrl || makeAvatarFallback(lower, "twitch"),
              isLive: Boolean(live),
              title: live?.title || "",
              category: live?.game_name || "",
              viewerCount: live?.viewer_count ?? 0,
              startedAt: live?.started_at ?? null,
              thumbnailUrl: thumb,
              streamId: live?.id ?? null,
              source: "official",
              checkedAt: now,
            };
          });

          return { statuses, health: "official" };
        }
      } catch {
        // Fall through to public tier
      }
    }
  }

  // Tier 2: Zero-config fast public Twitch live lookup (ivr.fi batch endpoint)
  try {
    const responses = await Promise.all(
      chunk(logins, 50).map((group) =>
        fetch(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(group.join(","))}`, {
          headers: {
            Accept: "application/json",
            "User-Agent": "Streamex/1.0",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(3200),
        }).catch(() => null),
      ),
    );

    if (responses.some((r) => r?.ok)) {
      const map = new Map<string, IvrTwitchUser>();
      for (const r of responses) {
        if (!r?.ok) continue;
        const users = (await r.json().catch(() => [])) as IvrTwitchUser[];
        for (const u of Array.isArray(users) ? users : []) {
          if (u.login) map.set(u.login.toLowerCase(), u);
        }
      }

      const statuses: LiveChannelStatus[] = channels.map((ch) => {
        const lower = ch.slug.toLowerCase();
        const u = map.get(lower);
        const stream = u?.stream ?? null;
        const isLive = Boolean(stream && stream.id);
        return {
          id: ch.id,
          platform: "twitch",
          slug: lower,
          displayName: u?.displayName || ch.displayName,
          avatarUrl: u?.logo || ch.avatarUrl || makeAvatarFallback(lower, "twitch"),
          isLive,
          title: stream?.title || "",
          category: stream?.game?.displayName || "",
          viewerCount: stream?.viewersCount ?? 0,
          startedAt: stream?.createdAt ?? null,
          thumbnailUrl: isLive
            ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${lower}-640x360.jpg?t=${previewBucket}`
            : "",
          streamId: stream?.id ?? null,
          source: "public",
          checkedAt: now,
        };
      });

      return { statuses, health: "public" };
    }
  } catch {
    // Graceful offline fallback
  }

  return {
    statuses: channels.map((ch) => ({
      id: ch.id,
      platform: "twitch",
      slug: ch.slug.toLowerCase(),
      displayName: ch.displayName,
      avatarUrl: ch.avatarUrl || makeAvatarFallback(ch.slug, "twitch"),
      isLive: false,
      title: "",
      category: "",
      viewerCount: 0,
      startedAt: null,
      thumbnailUrl: "",
      streamId: null,
      source: "fallback",
      checkedAt: now,
    })),
    health: "offline",
  };
}

interface KickOfficialChannel {
  broadcaster_user_id?: number;
  slug?: string;
  stream_title?: string;
  banner_picture?: string;
  category?: { id?: number; name?: string; thumbnail?: string };
  stream?: {
    is_live?: boolean;
    viewer_count?: number;
    start_time?: string;
    thumbnail?: string;
    url?: string;
  };
}

interface KickV2Channel {
  slug?: string;
  user?: {
    username?: string;
    profile_pic?: string;
  };
  playback_url?: string;
  livestream?: {
    id?: number;
    session_title?: string;
    is_live?: boolean;
    viewer_count?: number;
    created_at?: string;
    thumbnail?: { url?: string };
    categories?: Array<{ name?: string }>;
  } | null;
}

const kickThumbCache = new Map<string, { url: string; cachedAt: number }>();

/** v2 channel thumbnails (stream.kick.com/…/thumb0.jpg) return 403; the livestream endpoint's don't. */
async function getKickLiveThumb(slug: string): Promise<string> {
  const cached = kickThumbCache.get(slug);
  if (cached && Date.now() - cached.cachedAt < 60_000) return cached.url;
  try {
    const res = await fetch(
      `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/livestream`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(1500),
      },
    );
    if (res.ok) {
      const json = (await res.json()) as { data?: { thumbnail?: { src?: string } } | null };
      const url = json.data?.thumbnail?.src || "";
      kickThumbCache.set(slug, { url, cachedAt: Date.now() });
      return url;
    }
  } catch {
    // keep previous value
  }
  return cached?.url ?? "";
}

const kickProfileCache = new Map<number, { name: string; avatar: string; cachedAt: number }>();

async function getKickProfiles(ids: number[], headers: Record<string, string>) {
  const now = Date.now();
  const result = new Map<number, { name: string; avatar: string }>();
  const missing: number[] = [];
  for (const id of ids) {
    const cached = kickProfileCache.get(id);
    if (cached && now - cached.cachedAt < USER_CACHE_TTL_MS) result.set(id, cached);
    else missing.push(id);
  }
  await Promise.all(
    chunk(missing, 50).map(async (group) => {
      const res = await fetch(
        `https://api.kick.com/public/v1/users?${group.map((id) => `id=${id}`).join("&")}`,
        { headers, cache: "no-store", signal: AbortSignal.timeout(3000) },
      ).catch(() => null);
      if (!res?.ok) return;
      const json = (await res.json().catch(() => null)) as {
        data?: Array<{ user_id: number; name: string; profile_picture?: string }>;
      } | null;
      for (const u of json?.data ?? []) {
        const entry = { name: u.name, avatar: u.profile_picture || "", cachedAt: now };
        kickProfileCache.set(u.user_id, entry);
        result.set(u.user_id, entry);
      }
    }),
  );
  return result;
}

async function fetchKickLiveStatuses(
  channels: FollowedChannel[],
  creds: ResolvedCredentials,
): Promise<{ statuses: LiveChannelStatus[]; health: ApiHealth["kick"] }> {
  const now = Date.now();
  if (channels.length === 0) {
    return {
      statuses: [],
      health: creds.kickClientId && creds.kickClientSecret ? "official" : "needs_key",
    };
  }

  // Tier 1: Official Kick Public API v1 (single batched call)
  if (creds.kickClientId && creds.kickClientSecret) {
    const token = await getKickAppToken(creds.kickClientId, creds.kickClientSecret);
    if (token) {
      try {
        const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
        const responses = await Promise.all(
          chunk(channels, 50).map((group) =>
            fetch(
              `https://api.kick.com/public/v1/channels?${group
                .map((c) => `slug=${encodeURIComponent(c.slug.toLowerCase())}`)
                .join("&")}`,
              { headers, cache: "no-store", signal: AbortSignal.timeout(3200) },
            ),
          ),
        );

        if (responses.every((r) => r.ok)) {
          const pages = (await Promise.all(responses.map((r) => r.json()))) as Array<{
            data?: KickOfficialChannel[];
          }>;
          const map = new Map<string, KickOfficialChannel>();
          for (const item of pages.flatMap((p) => p.data ?? [])) {
            if (item.slug) map.set(item.slug.toLowerCase(), item);
          }
          const profiles = await getKickProfiles(
            [...map.values()]
              .map((c) => c.broadcaster_user_id)
              .filter((id): id is number => Boolean(id)),
            headers,
          );

          const statuses: LiveChannelStatus[] = channels.map((ch) => {
            const lower = ch.slug.toLowerCase();
            const k = map.get(lower);
            const isLive = Boolean(k?.stream?.is_live);
            const profile = k?.broadcaster_user_id
              ? profiles.get(k.broadcaster_user_id)
              : undefined;
            return {
              id: ch.id,
              platform: "kick",
              slug: lower,
              displayName: profile?.name || ch.displayName || k?.slug || lower,
              avatarUrl: profile?.avatar || ch.avatarUrl || makeAvatarFallback(lower, "kick"),
              isLive,
              title: k?.stream_title || "",
              category: k?.category?.name || "",
              viewerCount: k?.stream?.viewer_count ?? 0,
              startedAt: k?.stream?.start_time ? kickDate(k.stream.start_time) : null,
              thumbnailUrl: isLive ? k?.stream?.thumbnail || "" : "",
              streamId: k?.broadcaster_user_id ? String(k.broadcaster_user_id) : null,
              // stream.url in the official API is the RTMPS ingest URL, not a playback URL
              playbackUrl: null,
              source: "official",
              checkedAt: now,
            };
          });

          return { statuses, health: "official" };
        }
      } catch {
        // Fall through to tier 2
      }
    }
  }

  // Tier 2: Direct Kick public JSON endpoint (clean attempt; no anti-bot bypass)
  let anyPublicOk = false;
  const settled = await Promise.all(
    channels.map(async (ch): Promise<LiveChannelStatus> => {
      const lower = ch.slug.toLowerCase();
      try {
        const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(lower)}`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(2200),
        });
        if (res.ok) {
          const data = (await res.json()) as KickV2Channel;
          anyPublicOk = true;
          const ls = data.livestream;
          const isLive = Boolean(ls && ls.is_live !== false);
          return {
            id: ch.id,
            platform: "kick",
            slug: lower,
            displayName: data.user?.username || ch.displayName,
            avatarUrl: data.user?.profile_pic || ch.avatarUrl || makeAvatarFallback(lower, "kick"),
            isLive,
            title: ls?.session_title || "",
            category: ls?.categories?.[0]?.name || "",
            viewerCount: ls?.viewer_count ?? 0,
            startedAt: ls?.created_at ? kickDate(ls.created_at) : null,
            thumbnailUrl: isLive ? await getKickLiveThumb(lower) : "",
            streamId: ls?.id ? String(ls.id) : null,
            playbackUrl: data.playback_url || null,
            source: "public",
            checkedAt: now,
          };
        }
      } catch {
        // Expected when Kick requires official API key
      }

      return {
        id: ch.id,
        platform: "kick",
        slug: lower,
        displayName: ch.displayName,
        avatarUrl: ch.avatarUrl || makeAvatarFallback(lower, "kick"),
        isLive: false,
        title: "",
        category: "",
        viewerCount: 0,
        startedAt: null,
        thumbnailUrl: "",
        streamId: null,
        playbackUrl: null,
        source: "fallback",
        checkedAt: now,
      };
    }),
  );

  return {
    statuses: settled,
    health: anyPublicOk ? "public" : "needs_key",
  };
}

export async function fetchAllLiveStatuses(
  channels: FollowedChannel[],
  creds: ResolvedCredentials,
): Promise<{ statuses: LiveChannelStatus[]; apiHealth: ApiHealth }> {
  const twitchChannels = channels.filter((c) => c.platform === "twitch");
  const kickChannels = channels.filter((c) => c.platform === "kick");
  const youtubeChannels = channels.filter((c) => c.platform === "youtube");

  const [twitchRes, kickRes, youtubeStatuses] = await Promise.all([
    fetchTwitchLiveStatuses(twitchChannels, creds),
    fetchKickLiveStatuses(kickChannels, creds),
    fetchYoutubeLiveStatuses(youtubeChannels),
  ]);

  const statuses = [...twitchRes.statuses, ...kickRes.statuses, ...youtubeStatuses].sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    if (a.isLive && b.isLive) return b.viewerCount - a.viewerCount;
    return a.displayName.localeCompare(b.displayName);
  });

  return {
    statuses,
    apiHealth: {
      twitch: twitchRes.health,
      kick: kickRes.health,
      serverHasTwitchEnv: Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET),
      serverHasKickEnv: Boolean(process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET),
    },
  };
}

/** Kick returns "2026-11-20 18:59:43" (UTC, no zone). Safari can't parse that; make it ISO. */
function kickDate(raw?: string): string {
  if (!raw) return new Date().toISOString();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(" ", "T")}Z` : raw;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

/** Run `fn` over `list` with at most `limit` in flight. */
async function mapLimit<T>(list: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) {
      const item = list[i++];
      await fn(item).catch(() => undefined);
    }
  });
  await Promise.all(workers);
}

const channelItemsCache = new Map<string, { items: FeedItem[]; expiresAt: number }>();

/**
 * VODs and clips change slowly; cache them per channel so a 45s feed refresh over dozens of
 * followed channels doesn't hammer Twitch/Kick. Only cache when at least one upstream fetch
 * succeeded, so transient timeouts never poison the cache.
 */
async function cachedChannelItems(
  key: string,
  sink: FeedItem[],
  load: (out: FeedItem[]) => Promise<boolean>,
  bypassCache = false,
) {
  if (!bypassCache) {
    const hit = channelItemsCache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      sink.push(...hit.items);
      return;
    }
  }
  const out: FeedItem[] = [];
  const ok = await load(out);
  if (ok) {
    channelItemsCache.set(key, {
      items: out,
      expiresAt: Date.now() + (out.length > 0 ? 180_000 : 60_000),
    });
  }
  sink.push(...out);
}

export async function fetchUnifiedFeed(
  channels: FollowedChannel[],
  creds: ResolvedCredentials,
  perChannelLimit = 4,
  bypassCache = false,
): Promise<{ items: FeedItem[]; apiHealth: ApiHealth }> {
  const vodLimit = Math.min(20, Math.max(1, perChannelLimit));
  const clipLimit = Math.min(12, Math.max(1, perChannelLimit));
  const ytLimit = Math.min(15, Math.max(6, perChannelLimit));
  const { statuses, apiHealth } = await fetchAllLiveStatuses(channels, creds);
  const items: FeedItem[] = [];

  // 1. Add currently LIVE streams first
  for (const s of statuses) {
    if (!s.isLive) continue;
    items.push({
      id: `live:${s.platform}:${s.slug}`,
      platform: s.platform,
      channelSlug: s.slug,
      channelName: s.displayName,
      channelAvatar: s.avatarUrl,
      type: "live",
      title: s.title || `${s.displayName} está AO VIVO`,
      category: s.category || "Ao Vivo",
      thumbnailUrl: s.thumbnailUrl,
      durationSeconds: s.startedAt
        ? Math.max(0, Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000))
        : 0,
      viewCount: s.viewerCount,
      createdAt: s.startedAt || new Date().toISOString(),
      startedAt: s.startedAt || undefined,
      streamId: s.streamId || undefined,
      url:
        s.platform === "youtube" && s.streamId
          ? `https://www.youtube.com/watch?v=${s.streamId}`
          : channelUrl(s.platform, s.slug),
      videoId: s.platform === "youtube" ? (s.streamId ?? undefined) : undefined,
      hlsUrl: s.playbackUrl || undefined,
      tags: [
        `${s.platform === "youtube" ? "YouTube" : s.platform === "twitch" ? "Twitch" : "Kick"} Live`,
        s.category || "Streaming",
      ].filter(Boolean),
    });
  }

  // 2-4. Fetch Twitch, Kick, and YouTube VODs/clips in parallel so large multi-platform lists stay fast.
  const twitchChannels = channels.filter((c) => c.platform === "twitch");
  const kickChannels = channels.filter((c) => c.platform === "kick");
  const youtubeChannels = channels.filter((c) => c.platform === "youtube");

  const fetchTwitchArchive = async () => {
    if (twitchChannels.length === 0 || !creds.twitchClientId || !creds.twitchClientSecret) return;
    const token = await getTwitchAppToken(creds.twitchClientId, creds.twitchClientSecret);
    if (!token) return;
    const userMap = await getTwitchUsersOfficial(
      twitchChannels.map((c) => c.slug),
      creds.twitchClientId,
      token,
    );

    const startedAt14Days = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    await mapLimit(twitchChannels.slice(0, 250), 12, (ch) =>
      cachedChannelItems(
        `twitch:${ch.slug.toLowerCase()}:${vodLimit}`,
        items,
        async (out) => {
          const meta = userMap.get(ch.slug.toLowerCase());
          if (!meta) return false;

          const [vodsRes, clipsRes] = await Promise.all([
            fetch(
              `https://api.twitch.tv/helix/videos?user_id=${encodeURIComponent(meta.id)}&type=archive&first=${vodLimit}`,
              {
                headers: {
                  "Client-Id": creds.twitchClientId!,
                  Authorization: `Bearer ${token}`,
                },
                cache: "no-store",
                signal: AbortSignal.timeout(6000),
              },
            ).catch(() => null),
            fetch(
              `https://api.twitch.tv/helix/clips?broadcaster_id=${encodeURIComponent(meta.id)}&first=${clipLimit}&started_at=${encodeURIComponent(startedAt14Days)}`,
              {
                headers: {
                  "Client-Id": creds.twitchClientId!,
                  Authorization: `Bearer ${token}`,
                },
                cache: "no-store",
                signal: AbortSignal.timeout(6000),
              },
            ).catch(() => null),
          ]);

          if (vodsRes && vodsRes.ok) {
            const vodsJson = (await vodsRes.json()) as {
              data?: Array<{
                id: string;
                title: string;
                created_at: string;
                duration: string;
                view_count: number;
                thumbnail_url: string;
                url: string;
              }>;
            };
            const liveMatch = statuses.find(
              (s) => s.platform === "twitch" && s.slug === meta.login && s.isLive,
            );
            for (const v of vodsJson.data ?? []) {
              const isProcessingThumb =
                !v.thumbnail_url || /\/_404\/|404_processing|404_preview/i.test(v.thumbnail_url);
              // Twitch returns a 403 `404_processing` URL for in-progress / freshly ended VODs.
              // Fall back to the live stream preview while live, or empty (clean poster) otherwise.
              const thumb = isProcessingThumb
                ? liveMatch?.thumbnailUrl || ""
                : v.thumbnail_url.replace("%{width}", "640").replace("%{height}", "360");
              out.push({
                id: `twitch:vod:${v.id}`,
                platform: "twitch",
                channelSlug: meta.login,
                channelName: meta.displayName,
                channelAvatar: meta.avatarUrl,
                type: "vod",
                title: v.title,
                category: "VOD • Transmissão Gravada",
                thumbnailUrl: thumb,
                durationSeconds: parseTwitchDuration(v.duration),
                viewCount: v.view_count,
                createdAt: v.created_at,
                url: v.url,
                videoId: v.id,
                tags: ["VOD", "Twitch", "Replay"],
              });
            }
          }

          if (clipsRes && clipsRes.ok) {
            const clipsJson = (await clipsRes.json()) as {
              data?: Array<{
                id: string;
                title: string;
                created_at: string;
                duration: number;
                view_count: number;
                thumbnail_url: string;
                url: string;
                embed_url: string;
                video_id: string;
                vod_offset: number | null;
              }>;
            };
            for (const c of clipsJson.data ?? []) {
              out.push({
                id: `twitch:clip:${c.id}`,
                platform: "twitch",
                channelSlug: meta.login,
                channelName: meta.displayName,
                channelAvatar: meta.avatarUrl,
                type: "clip",
                title: c.title,
                category: "Clipe em Alta",
                thumbnailUrl: c.thumbnail_url,
                durationSeconds: Math.round(c.duration || 30),
                viewCount: c.view_count,
                createdAt: c.created_at,
                url: c.url,
                clipId: c.id,
                videoId: c.video_id || undefined,
                embedUrl: c.embed_url,
                tags: ["Clipe", "Twitch"],
              });
            }
          }

          return Boolean(vodsRes?.ok || clipsRes?.ok);
        },
        bypassCache,
      ),
    );
  };

  const fetchKickArchive = async () => {
    if (kickChannels.length === 0 || apiHealth.kick === "needs_key") return;
    await mapLimit(kickChannels.slice(0, 150), 6, (ch) =>
      cachedChannelItems(
        `kick:${ch.slug.toLowerCase()}:${vodLimit}`,
        items,
        async (out) => {
          const lower = ch.slug.toLowerCase();
          try {
            const [vodsRes, clipsRes] = await Promise.all([
              fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(lower)}/videos`, {
                headers: { Accept: "application/json" },
                cache: "no-store",
                signal: AbortSignal.timeout(3000),
              }).catch(() => null),
              fetch(
                `https://kick.com/api/v2/channels/${encodeURIComponent(lower)}/clips?cursor=0&sort=view&time=week`,
                {
                  headers: { Accept: "application/json" },
                  cache: "no-store",
                  signal: AbortSignal.timeout(3000),
                },
              ).catch(() => null),
            ]);

            const statusMatch = statuses.find((s) => s.platform === "kick" && s.slug === lower);
            const avatar =
              statusMatch?.avatarUrl || ch.avatarUrl || makeAvatarFallback(lower, "kick");

            if (vodsRes && vodsRes.ok) {
              const vodsData = (await vodsRes.json()) as Array<{
                id?: number;
                is_live?: boolean;
                session_title?: string;
                duration?: number;
                views?: number;
                created_at?: string;
                thumbnail?: { src?: string };
                source?: string;
                video?: { uuid?: string };
                categories?: Array<{ name?: string }>;
              }>;
              for (const v of (Array.isArray(vodsData) ? vodsData : [])
                // the in-progress broadcast is listed as a VOD with duration 0 — it's the live, skip it
                .filter((v) => !v.is_live && (v.duration ?? 0) > 0)
                .slice(0, vodLimit)) {
                const uuid = v.video?.uuid || String(v.id || "");
                if (!uuid) continue;
                out.push({
                  id: `kick:vod:${uuid}`,
                  platform: "kick",
                  channelSlug: lower,
                  channelName: statusMatch?.displayName || ch.displayName,
                  channelAvatar: avatar,
                  type: "vod",
                  title: v.session_title || `VOD de ${ch.displayName}`,
                  category: v.categories?.[0]?.name || "Kick VOD",
                  thumbnailUrl: v.thumbnail?.src || "",
                  durationSeconds: Math.round((v.duration ?? 0) / 1000),
                  viewCount: v.views ?? 0,
                  createdAt: kickDate(v.created_at),
                  url: `https://kick.com/${lower}/videos/${uuid}`,
                  videoId: uuid,
                  hlsUrl: v.source || undefined,
                  tags: ["VOD", "Kick", v.categories?.[0]?.name || "Replay"],
                });
              }
            }

            if (clipsRes && clipsRes.ok) {
              const clipsJson = (await clipsRes.json()) as {
                clips?: Array<{
                  id?: string;
                  title?: string;
                  duration?: number;
                  views?: number;
                  created_at?: string;
                  thumbnail_url?: string;
                  clip_url?: string;
                  category?: { name?: string };
                }>;
              };
              for (const c of (clipsJson.clips ?? []).slice(0, clipLimit)) {
                if (!c.id) continue;
                out.push({
                  id: `kick:clip:${c.id}`,
                  platform: "kick",
                  channelSlug: lower,
                  channelName: statusMatch?.displayName || ch.displayName,
                  channelAvatar: avatar,
                  type: "clip",
                  title: c.title || `Clipe de ${ch.displayName}`,
                  category: c.category?.name || "Kick Clipe",
                  thumbnailUrl: c.thumbnail_url || "",
                  durationSeconds: Math.round(c.duration ?? 30),
                  viewCount: c.views ?? 0,
                  createdAt: kickDate(c.created_at),
                  url: `https://kick.com/${lower}/clips/${c.id}`,
                  clipId: c.id,
                  hlsUrl: c.clip_url || undefined,
                  tags: ["Clipe", "Kick"],
                });
              }
            }

            return Boolean(vodsRes?.ok || clipsRes?.ok);
          } catch {
            // Ignore individual channel errors
            return false;
          }
        },
        bypassCache,
      ),
    );
  };

  const fetchYoutubeArchive = async () => {
    await mapLimit(youtubeChannels.slice(0, 100), 6, async (ch) => {
      const status = statuses.find((st) => st.platform === "youtube" && st.slug === ch.slug);
      const uploads = await fetchYoutubeVideos(ch, status?.avatarUrl || ch.avatarUrl || "", ytLimit);
      // the current live also shows up as an upload — it's already in the feed as a live card
      items.push(...uploads.filter((u) => u.videoId !== status?.streamId));
    });
  };

  await Promise.all([fetchTwitchArchive(), fetchKickArchive(), fetchYoutubeArchive()]);

  // Sort: live first, then newest VODs/clips
  items.sort((a, b) => {
    if (a.type === "live" && b.type !== "live") return -1;
    if (b.type === "live" && a.type !== "live") return 1;
    if (a.type === "live" && b.type === "live") return b.viewCount - a.viewCount;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return { items, apiHealth };
}

export async function lookupSingleChannel(
  platform: Platform,
  rawQuery: string,
  creds: ResolvedCredentials,
): Promise<{
  slug: string;
  displayName: string;
  avatarUrl: string;
  isLive: boolean;
  verified: boolean;
}> {
  if (platform === "youtube") {
    // YouTube channels are stored by their stable UC… id; the handle/URL is only for finding it.
    const yt = await resolveYoutubeChannel(rawQuery);
    if (!yt) throw new Error("youtube_channel_not_found");
    return {
      slug: yt.id,
      displayName: yt.name,
      avatarUrl: yt.avatarUrl,
      isLive: false,
      verified: true,
    };
  }
  const slug = rawQuery
    .trim()
    .replace(/^https?:\/\/(www\.)?(twitch\.tv|kick\.com)\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0]
    .toLowerCase();

  const tempChannel: FollowedChannel = {
    id: `${platform}:${slug}`,
    platform,
    slug,
    displayName: slug,
    addedAt: Date.now(),
  };

  const { statuses } = await fetchAllLiveStatuses([tempChannel], creds);
  const found = statuses[0];

  return {
    slug,
    displayName: found?.displayName || slug,
    avatarUrl: found?.avatarUrl || makeAvatarFallback(slug, platform),
    isLive: Boolean(found?.isLive),
    verified: found?.source === "official" || found?.source === "public",
  };
}

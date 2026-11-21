import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { FeedItem, FollowedChannel, Platform } from "@/types/streamex";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0 || !Number.isFinite(seconds)) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  }
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

export function formatTwitchTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  return `${h}h${m}m${rem}s`;
}

export function parseTwitchDuration(raw: string): number {
  if (!raw) return 0;
  const hMatch = raw.match(/(\d+)h/);
  const mMatch = raw.match(/(\d+)m/);
  const sMatch = raw.match(/(\d+)s/);
  const h = hMatch ? parseInt(hMatch[1], 10) : 0;
  const m = mMatch ? parseInt(mMatch[1], 10) : 0;
  const s = sMatch ? parseInt(sMatch[1], 10) : 0;
  return h * 3600 + m * 60 + s;
}

export function formatViewerCount(count: number): string {
  if (!count || count <= 0) return "0";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString("pt-BR");
}

export function formatUptime(startedAt: string | null): string {
  if (!startedAt) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  return formatDuration(diffSec);
}

export function formatRelativeDate(dateIso: string): string {
  if (!dateIso) return "Agora";
  const ts = new Date(dateIso).getTime();
  if (Number.isNaN(ts)) return "Recente";
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return "Agora mesmo";
  if (diffMin < 60) return `há ${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `há ${diffD}d`;
  return new Date(ts).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function buildProgressKey(
  item: Pick<FeedItem, "platform" | "type" | "channelSlug" | "videoId" | "clipId" | "id">,
): string {
  if (item.type === "vod" && item.videoId) {
    return `${item.platform}:vod:${item.videoId}`;
  }
  if (item.type === "clip" && item.clipId) {
    return `${item.platform}:clip:${item.clipId}`;
  }
  return `${item.platform}:${item.type}:${item.channelSlug.toLowerCase()}`;
}

export function getExternalPlatformUrl(item: FeedItem, resumeTimeSeconds?: number): string {
  const time = resumeTimeSeconds && resumeTimeSeconds > 5 ? Math.floor(resumeTimeSeconds) : 0;
  if (item.platform === "youtube") {
    // a live keeps its video id too; channelSlug is the UC… id
    if (item.videoId) {
      return `https://www.youtube.com/watch?v=${item.videoId}${time > 0 && item.type === "vod" ? `&t=${time}s` : ""}`;
    }
    return `https://www.youtube.com/channel/${item.channelSlug}`;
  }
  if (item.platform === "twitch") {
    if (item.type === "vod" && item.videoId) {
      const cleanId = item.videoId.replace(/^v/, "");
      return time > 0
        ? `https://www.twitch.tv/videos/${cleanId}?t=${formatTwitchTimestamp(time)}`
        : `https://www.twitch.tv/videos/${cleanId}`;
    }
    if (item.type === "clip" && item.url) {
      return item.url;
    }
    return `https://www.twitch.tv/${item.channelSlug}`;
  }

  // Kick
  if (item.type === "vod" && item.videoId) {
    return item.url || `https://kick.com/${item.channelSlug}/videos/${item.videoId}`;
  }
  if (item.type === "clip" && item.url) {
    return item.url;
  }
  return `https://kick.com/${item.channelSlug}`;
}

/**
 * Hand a live/VOD to the StreamKeep desktop app (registered `streamkeep://` handler).
 * A live URL starts a full capture there, so the broadcast is kept even if the platform drops the VOD.
 */
export function streamKeepUrl(
  item: Pick<FeedItem, "url" | "type" | "platform" | "channelSlug">,
): string {
  const target =
    item.type === "live" && item.platform !== "youtube"
      ? channelUrl(item.platform, item.channelSlug)
      : item.url;
  return `streamkeep://download?url=${encodeURIComponent(target)}&quality=best`;
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  twitch: "Twitch",
  kick: "Kick",
  youtube: "YouTube",
};

/** "na Twitch", "na Kick", "no YouTube" — Portuguese gender per platform. */
export const PLATFORM_IN: Record<Platform, string> = {
  twitch: "na Twitch",
  kick: "na Kick",
  youtube: "no YouTube",
};

/** Avatar ring color per platform (live indicators). */
export const PLATFORM_RING: Record<Platform, string> = {
  twitch: "ring-[#9146FF]",
  kick: "ring-[#53FC18]",
  youtube: "ring-[#FF0033]",
};

/** Public page of a channel. YouTube channels are stored by their UC… id. */
export function channelUrl(platform: Platform, slug: string): string {
  if (platform === "kick") return `https://kick.com/${slug}`;
  if (platform === "youtube") return `https://www.youtube.com/channel/${slug}`;
  return `https://www.twitch.tv/${slug}`;
}

export function makeAvatarFallback(slug: string, platform: Platform): string {
  const initial = (slug?.[0] || "S").toUpperCase();
  const bg = platform === "kick" ? "%2313250B" : platform === "youtube" ? "%23300810" : "%231E1236";
  const fg = platform === "kick" ? "%2353FC18" : platform === "youtube" ? "%23FF4D6A" : "%23A970FF";
  return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><rect width='80' height='80' rx='40' fill='${bg}'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' fill='${fg}' font-family='system-ui,sans-serif' font-weight='800' font-size='34'>${initial}</text></svg>`;
}

export const DEFAULT_CHANNELS: FollowedChannel[] = [
  { id: "twitch:gaules", platform: "twitch", slug: "gaules", displayName: "Gaules", addedAt: 1 },
  {
    id: "twitch:casimito",
    platform: "twitch",
    slug: "casimito",
    displayName: "Casimito",
    addedAt: 2,
  },
  { id: "twitch:caedrel", platform: "twitch", slug: "caedrel", displayName: "Caedrel", addedAt: 3 },
  {
    id: "twitch:loud_coringa",
    platform: "twitch",
    slug: "loud_coringa",
    displayName: "loud_coringa",
    addedAt: 4,
  },
  {
    id: "twitch:alanzoka",
    platform: "twitch",
    slug: "alanzoka",
    displayName: "alanzoka",
    addedAt: 5,
  },
  { id: "kick:xqc", platform: "kick", slug: "xqc", displayName: "xQc", addedAt: 6 },
  { id: "kick:adinross", platform: "kick", slug: "adinross", displayName: "AdinRoss", addedAt: 7 },
  { id: "kick:westcol", platform: "kick", slug: "westcol", displayName: "WestCOL", addedAt: 8 },
  {
    id: "kick:paulinholokobr",
    platform: "kick",
    slug: "paulinholokobr",
    displayName: "PaulinhoLOKO",
    addedAt: 9,
  },
];

/** Critically damped (Apple "damping 1.0"): no overshoot — the default for all UI. */
export const BENJI_SPRING = {
  type: "spring" as const,
  bounce: 0,
  duration: 0.32,
};

/** Slightly softer, still no overshoot — for larger surfaces. */
export const BENJI_SOFT_SPRING = {
  type: "spring" as const,
  bounce: 0,
  duration: 0.45,
};

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

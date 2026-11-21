import type { FeedItem, LiveChannelStatus, Platform, WatchProgress } from "@/types/streamex";
import { buildProgressKey, getExternalPlatformUrl } from "@/lib/utils";

/** Fraction after which a VOD counts as watched and leaves "Continuar assistindo". */
export const FINISHED_AT = 0.95;
/** Positions below this aren't worth resuming. */
export const MIN_RESUME_SECONDS = 10;
/** Keep live exit checkpoints for up to 7 days so delayed VODs still pick them up. */
const LIVE_CHECKPOINT_TTL_MS = 7 * 24 * 3600 * 1000;
/** Same broadcast tolerance when comparing start timestamps across API tiers. */
const SAME_STREAM_WINDOW_MS = 15 * 60 * 1000;
/** Tolerance between a live's `startedAt` and its archived VOD's `createdAt`. */
const VOD_MATCH_WINDOW_MS = 35 * 60 * 1000;

/**
 * Only VODs appear in the "Continuar assistindo" rail. Live exit checkpoints are stored alongside
 * them (keyed per broadcast) and automatically promoted into VOD progress once the VOD appears.
 */
export function isResumable(p: WatchProgress): boolean {
  if (p.contentType !== "vod") return false;
  if (p.watched) return false;
  if (!p.currentTime || p.currentTime < MIN_RESUME_SECONDS) return false;
  if (p.duration > 0 && p.currentTime / p.duration >= FINISHED_AT) return false;
  return true;
}

/** True when a VOD was explicitly marked as watched or reached the finished threshold (>= 95%). */
export function isWatchedVod(p: WatchProgress | undefined): boolean {
  if (!p || p.contentType !== "vod") return false;
  if (p.watched) return true;
  return p.duration > 0 && p.currentTime / p.duration >= FINISHED_AT;
}

/** True for real live exit checkpoints (broadcast offset backed by `streamStartedAt` or YouTube `streamId`). */
export function isLiveCheckpoint(p: WatchProgress | undefined): boolean {
  if (!p || p.contentType !== "live") return false;
  if (!p.currentTime || p.currentTime < MIN_RESUME_SECONDS) return false;
  if (!p.streamStartedAt && !(p.platform === "youtube" && p.streamId)) return false;
  if (p.updatedAt && Date.now() - p.updatedAt > LIVE_CHECKPOINT_TTL_MS) return false;
  return true;
}

/** Stable storage key for a live broadcast's exit checkpoint (one per broadcast, not per channel). */
export function buildLiveCheckpointKey(target: {
  platform: Platform;
  channelSlug: string;
  startedAt?: string | null;
  streamId?: string | null;
}): string {
  const slug = target.channelSlug.toLowerCase();
  if (target.platform === "youtube" && target.streamId) {
    return `youtube:live:${slug}:${target.streamId}`;
  }
  const ts = target.startedAt ? Date.parse(target.startedAt) : NaN;
  if (!Number.isNaN(ts)) {
    return `${target.platform}:live:${slug}:${Math.floor(ts / 600_000)}`;
  }
  return `${target.platform}:live:${slug}`;
}

/** Whether a saved live checkpoint belongs to the same live broadcast as `target`. */
export function sameLiveBroadcast(
  checkpoint: WatchProgress,
  target: {
    platform: Platform;
    channelSlug: string;
    startedAt?: string | null;
    streamId?: string | null;
  },
): boolean {
  if (!isLiveCheckpoint(checkpoint)) return false;
  if (checkpoint.platform !== target.platform) return false;
  if (checkpoint.channelSlug.toLowerCase() !== target.channelSlug.toLowerCase()) return false;

  if (checkpoint.platform === "youtube" && checkpoint.streamId && target.streamId) {
    return checkpoint.streamId === target.streamId;
  }

  if (checkpoint.streamStartedAt && target.startedAt) {
    const a = Date.parse(checkpoint.streamStartedAt);
    const b = Date.parse(target.startedAt);
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      return Math.abs(a - b) <= SAME_STREAM_WINDOW_MS;
    }
  }

  // Fallback for Twitch (streamId changes per broadcast; Kick official uses broadcaster_user_id so skip Kick).
  if (checkpoint.platform === "twitch" && checkpoint.streamId && target.streamId) {
    return checkpoint.streamId === target.streamId;
  }
  return false;
}

/** Find the newest saved exit checkpoint for a specific currently-live broadcast. */
export function findLiveCheckpointForBroadcast(
  map: Record<string, WatchProgress>,
  target: {
    platform: Platform;
    channelSlug: string;
    startedAt?: string | null;
    streamId?: string | null;
  },
): WatchProgress | undefined {
  let best: WatchProgress | undefined;
  for (const entry of Object.values(map)) {
    if (!sameLiveBroadcast(entry, target)) continue;
    if (!best || (entry.updatedAt ?? 0) > (best.updatedAt ?? 0)) best = entry;
  }
  return best;
}

/** Whether a VOD in the feed is the archived recording of the live broadcast in `checkpoint`. */
export function doesCheckpointMatchVod(checkpoint: WatchProgress, vod: FeedItem): boolean {
  if (!isLiveCheckpoint(checkpoint)) return false;
  if (vod.type !== "vod" || !vod.videoId) return false;
  if (vod.platform !== checkpoint.platform) return false;
  if (vod.channelSlug.toLowerCase() !== checkpoint.channelSlug.toLowerCase()) return false;

  // YouTube keeps the exact same videoId when a live stream becomes a VOD.
  if (checkpoint.platform === "youtube" && checkpoint.streamId) {
    return checkpoint.streamId === vod.videoId;
  }

  if (!checkpoint.streamStartedAt || !vod.createdAt) return false;
  const liveStart = Date.parse(checkpoint.streamStartedAt);
  const vodCreated = Date.parse(vod.createdAt);
  if (Number.isNaN(liveStart) || Number.isNaN(vodCreated)) return false;

  // Twitch & Kick archive `created_at` is the broadcast start time.
  if (Math.abs(vodCreated - liveStart) <= VOD_MATCH_WINDOW_MS) return true;

  // Safety net if a platform reports VOD creation near broadcast end instead of start.
  if (vod.durationSeconds > 0) {
    const inferredStart = vodCreated - vod.durationSeconds * 1000;
    if (Math.abs(inferredStart - liveStart) <= VOD_MATCH_WINDOW_MS) return true;
  }

  return false;
}

/** Build a VOD `WatchProgress` entry carried over from a live exit checkpoint. */
export function buildVodProgressFromLive(checkpoint: WatchProgress, vod: FeedItem): WatchProgress {
  const vodKey = buildProgressKey(vod);
  const resumeAt =
    vod.durationSeconds > 30
      ? Math.min(checkpoint.currentTime, Math.max(0, vod.durationSeconds - 15))
      : checkpoint.currentTime;
  return {
    key: vodKey,
    platform: vod.platform,
    channelSlug: vod.channelSlug,
    channelName: vod.channelName,
    contentType: "vod",
    videoId: vod.videoId,
    title: vod.title,
    thumbnailUrl: vod.thumbnailUrl || checkpoint.thumbnailUrl,
    currentTime: Math.max(0, Math.floor(resumeAt)),
    duration: vod.durationSeconds,
    updatedAt: checkpoint.updatedAt,
    url: getExternalPlatformUrl(vod, resumeAt),
    source: "streamex",
    bookmarks: checkpoint.bookmarks ?? [],
    streamStartedAt: checkpoint.streamStartedAt,
    streamId: checkpoint.streamId,
    fromLive: true,
  };
}

/**
 * Once a watched live ends and its archived VOD appears in the feed, automatically create a VOD
 * progress entry at the exact minute the user left the live so it lands in "Continuar assistindo"
 * and resumes there when opened.
 */
export function promoteLiveCheckpointsToVods(
  progressMap: Record<string, WatchProgress>,
  feedItems: FeedItem[],
  statuses: LiveChannelStatus[],
  progressDeleted: Record<string, number>,
): { next: Record<string, WatchProgress>; changed: boolean; promoted: WatchProgress[] } {
  const checkpoints = Object.values(progressMap).filter(isLiveCheckpoint);
  if (checkpoints.length === 0) return { next: progressMap, changed: false, promoted: [] };

  const vods = feedItems.filter((i) => i.type === "vod" && Boolean(i.videoId));
  if (vods.length === 0) return { next: progressMap, changed: false, promoted: [] };

  let next = progressMap;
  let changed = false;
  const promoted: WatchProgress[] = [];

  for (const cp of checkpoints) {
    // Wait until the broadcast is no longer live (while live, the user sees the live banner instead).
    const status = statuses.find(
      (s) => s.platform === cp.platform && s.slug.toLowerCase() === cp.channelSlug.toLowerCase(),
    );
    if (
      status?.isLive &&
      sameLiveBroadcast(cp, {
        platform: status.platform,
        channelSlug: status.slug,
        startedAt: status.startedAt,
        streamId: status.streamId,
      })
    ) {
      continue;
    }

    const match = vods.find((v) => doesCheckpointMatchVod(cp, v));
    if (!match) continue;

    // If the user watched almost the entire live (>= 95%), don't clutter "Continuar assistindo".
    if (match.durationSeconds > 0 && cp.currentTime / match.durationSeconds >= FINISHED_AT) {
      if (!changed) next = { ...progressMap };
      delete next[cp.key];
      changed = true;
      continue;
    }

    const vodKey = buildProgressKey(match);
    const deletedAt = progressDeleted[vodKey];
    if (deletedAt !== undefined && deletedAt >= (cp.updatedAt ?? 0)) {
      continue;
    }

    if (!next[vodKey]) {
      const entry = buildVodProgressFromLive(cp, match);
      if (isResumable(entry)) {
        if (!changed) next = { ...progressMap };
        next[vodKey] = entry;
        delete next[cp.key];
        changed = true;
        promoted.push(entry);
      }
    } else {
      // User already started watching this VOD directly; retire the live checkpoint.
      if (!changed) next = { ...progressMap };
      delete next[cp.key];
      changed = true;
    }
  }

  return { next, changed, promoted };
}

/** Drop expired/unusable entries so storage and sync stay clean. */
export function pruneProgressMap(
  map: Record<string, WatchProgress>,
): Record<string, WatchProgress> {
  const out: Record<string, WatchProgress> = {};
  for (const [k, v] of Object.entries(map)) {
    if (!v) continue;
    if (v.contentType === "vod") out[k] = v;
    else if (isLiveCheckpoint(v)) out[k] = v;
    else if (v.bookmarks?.length) out[k] = v; // keep user-made bookmarks
  }
  return out;
}

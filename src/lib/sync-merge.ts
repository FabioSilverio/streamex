import type { FollowedChannel, WatchProgress } from "@/types/streamex";

/**
 * Everything that follows the user between devices. Each part merges per item, newest wins,
 * so a phone and a PC editing at different times never wipe each other's changes:
 * - channels: newest version of each channel (by updatedAt/addedAt); removals live in `hidden`.
 * - hidden: channel id → when it was removed. A channel re-added later (newer timestamp) shows again.
 * - progress: newest position per VOD; `progressDeleted` remembers "removed from Continuar".
 * - bookmarks: the whole saved list, last writer wins (small and rarely edited).
 */
export interface SyncState {
  channels: FollowedChannel[];
  hidden: Record<string, number>;
  progress: Record<string, WatchProgress>;
  progressDeleted: Record<string, number>;
  bookmarks: string[];
  bookmarksUpdatedAt: number;
}

export const EMPTY_SYNC_STATE: SyncState = {
  channels: [],
  hidden: {},
  progress: {},
  progressDeleted: {},
  bookmarks: [],
  bookmarksUpdatedAt: 0,
};

const MAX_PROGRESS = 300;
const TOMBSTONE_TTL_MS = 60 * 24 * 3600 * 1000;

const stamp = (c: FollowedChannel) => c.updatedAt ?? c.addedAt ?? 0;

function maxMap(a: Record<string, number>, b: Record<string, number>) {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) if (!(k in out) || v > out[k]) out[k] = v;
  return out;
}

function pruneTombstones(map: Record<string, number>) {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  return Object.fromEntries(Object.entries(map).filter(([, ts]) => ts > cutoff));
}

export function sanitizeSyncState(raw: unknown): SyncState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<SyncState>;
  return {
    channels: Array.isArray(r.channels)
      ? r.channels.filter((c) => c && typeof c.id === "string" && typeof c.slug === "string")
      : [],
    hidden: r.hidden && typeof r.hidden === "object" ? r.hidden : {},
    progress: r.progress && typeof r.progress === "object" ? r.progress : {},
    progressDeleted:
      r.progressDeleted && typeof r.progressDeleted === "object" ? r.progressDeleted : {},
    bookmarks: Array.isArray(r.bookmarks) ? r.bookmarks.filter((b) => typeof b === "string") : [],
    bookmarksUpdatedAt: typeof r.bookmarksUpdatedAt === "number" ? r.bookmarksUpdatedAt : 0,
  };
}

export function mergeSyncState(a: SyncState, b: SyncState): SyncState {
  // Channels: newest version per id, then drop the ones removed after their last change.
  const hidden = pruneTombstones(maxMap(a.hidden, b.hidden));
  const byId = new Map<string, FollowedChannel>();
  for (const c of [...a.channels, ...b.channels]) {
    const cur = byId.get(c.id);
    if (!cur || stamp(c) > stamp(cur)) byId.set(c.id, c);
  }
  // Keep the order of `a` (the caller's own list) and append what only `b` had.
  const order = [...a.channels, ...b.channels].map((c) => c.id);
  const seen = new Set<string>();
  const channels: FollowedChannel[] = [];
  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = byId.get(id)!;
    const removedAt = hidden[id];
    if (removedAt !== undefined && removedAt >= stamp(c)) continue;
    channels.push(c);
  }

  // Progress: newest per key; a removal sticks unless the VOD was watched again afterwards.
  const progressDeleted = pruneTombstones(maxMap(a.progressDeleted, b.progressDeleted));
  const progress: Record<string, WatchProgress> = {};
  for (const src of [a.progress, b.progress]) {
    for (const [k, p] of Object.entries(src)) {
      if (!p || typeof p !== "object") continue;
      const cur = progress[k];
      if (!cur || (p.updatedAt ?? 0) > (cur.updatedAt ?? 0)) progress[k] = p;
    }
  }
  for (const [k, ts] of Object.entries(progressDeleted)) {
    if (progress[k] && (progress[k].updatedAt ?? 0) <= ts) delete progress[k];
  }
  const trimmed = Object.fromEntries(
    Object.entries(progress)
      .sort((x, y) => (y[1].updatedAt ?? 0) - (x[1].updatedAt ?? 0))
      .slice(0, MAX_PROGRESS),
  );

  const bookmarksFromA = a.bookmarksUpdatedAt >= b.bookmarksUpdatedAt;
  return {
    channels,
    hidden,
    progress: trimmed,
    progressDeleted,
    bookmarks: bookmarksFromA ? a.bookmarks : b.bookmarks,
    bookmarksUpdatedAt: Math.max(a.bookmarksUpdatedAt, b.bookmarksUpdatedAt),
  };
}

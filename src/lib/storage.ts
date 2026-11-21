import type { ApiCredentials, FeedItem, FollowedChannel, WatchProgress } from "@/types/streamex";
import { DEFAULT_CHANNELS } from "@/lib/utils";

const KEYS = {
  channels: "streamex:channels:v1",
  progress: "streamex:progress:v1",
  credentials: "streamex:creds:v1",
  endedVods: "streamex:ended-vods:v1",
  bookmarks: "streamex:bookmarked-ids:v1",
  hiddenChannels: "streamex:hidden-channels:v1",
  hiddenMap: "streamex:hidden-channels:v2",
  progressDeleted: "streamex:progress-deleted:v1",
  bookmarksUpdatedAt: "streamex:bookmarks-updated:v1",
  playerPrefs: "streamex:player-prefs:v1",
  vodPlayerPrefs: "streamex:vod-player-prefs:v1",
};

export interface PlayerPrefs {
  /** 0..1 */
  volume: number;
  muted: boolean;
  /** VOD playback speed (e.g. 0.5..2) */
  playbackRate: number;
}

const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  volume: 1,
  muted: false,
  playbackRate: 1,
};

function clampVolume(v: number | undefined, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, Math.round(v * 100) / 100));
}

function clampRate(r: number | undefined, fallback: number): number {
  if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) return fallback;
  return Math.min(4, Math.max(0.25, Math.round(r * 100) / 100));
}

type StoredVodPrefs = Partial<PlayerPrefs> & { updatedAt: number };

/** Load player preferences: per-VOD override takes precedence over the global default. */
export function loadPlayerPrefs(vodKey?: string): PlayerPrefs {
  const globalRaw = readJson<Partial<PlayerPrefs>>(KEYS.playerPrefs, {});
  const globalPrefs: PlayerPrefs = {
    volume: clampVolume(globalRaw.volume, DEFAULT_PLAYER_PREFS.volume),
    muted: typeof globalRaw.muted === "boolean" ? globalRaw.muted : DEFAULT_PLAYER_PREFS.muted,
    playbackRate: clampRate(globalRaw.playbackRate, DEFAULT_PLAYER_PREFS.playbackRate),
  };
  if (!vodKey) return globalPrefs;
  const perVodMap = readJson<Record<string, StoredVodPrefs>>(KEYS.vodPlayerPrefs, {});
  const perVod = perVodMap[vodKey];
  if (!perVod) return globalPrefs;
  return {
    volume: clampVolume(perVod.volume, globalPrefs.volume),
    muted: typeof perVod.muted === "boolean" ? perVod.muted : globalPrefs.muted,
    playbackRate: clampRate(perVod.playbackRate, globalPrefs.playbackRate),
  };
}

/** Save updated player preferences (updates global defaults and, when given, the specific VOD). */
export function savePlayerPrefs(patch: Partial<PlayerPrefs>, vodKey?: string) {
  const curGlobal = readJson<Partial<PlayerPrefs>>(KEYS.playerPrefs, {});
  const nextGlobal: PlayerPrefs = {
    volume:
      patch.volume !== undefined
        ? clampVolume(patch.volume, DEFAULT_PLAYER_PREFS.volume)
        : clampVolume(curGlobal.volume, DEFAULT_PLAYER_PREFS.volume),
    muted:
      typeof patch.muted === "boolean"
        ? patch.muted
        : typeof curGlobal.muted === "boolean"
          ? curGlobal.muted
          : DEFAULT_PLAYER_PREFS.muted,
    playbackRate:
      patch.playbackRate !== undefined
        ? clampRate(patch.playbackRate, DEFAULT_PLAYER_PREFS.playbackRate)
        : clampRate(curGlobal.playbackRate, DEFAULT_PLAYER_PREFS.playbackRate),
  };
  writeJson(KEYS.playerPrefs, nextGlobal);

  if (!vodKey) return;
  const perVodMap = readJson<Record<string, StoredVodPrefs>>(KEYS.vodPlayerPrefs, {});
  const prev = perVodMap[vodKey] ?? { updatedAt: Date.now() };
  perVodMap[vodKey] = {
    ...prev,
    ...(patch.volume !== undefined ? { volume: nextGlobal.volume } : {}),
    ...(typeof patch.muted === "boolean" ? { muted: nextGlobal.muted } : {}),
    ...(patch.playbackRate !== undefined ? { playbackRate: nextGlobal.playbackRate } : {}),
    updatedAt: Date.now(),
  };
  // Keep storage bounded to the 150 most recent VODs
  const entries = Object.entries(perVodMap)
    .sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0))
    .slice(0, 150);
  writeJson(KEYS.vodPlayerPrefs, Object.fromEntries(entries));
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

/** Channel id → when the user removed it. Follow syncs must not re-add these. */
export function loadHiddenMap(): Record<string, number> {
  const map = readJson<Record<string, number> | null>(KEYS.hiddenMap, null);
  if (map && typeof map === "object") return map;
  // migrate the old plain list
  const legacy = readJson<string[]>(KEYS.hiddenChannels, []);
  const now = Date.now();
  return Object.fromEntries((Array.isArray(legacy) ? legacy : []).map((id) => [id, now]));
}

export function saveHiddenMap(map: Record<string, number>) {
  const entries = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1000);
  writeJson(KEYS.hiddenMap, Object.fromEntries(entries));
}

export function loadHiddenChannelIds(): string[] {
  return Object.keys(loadHiddenMap());
}

/** Progress key → when it was removed from "Continuar assistindo". */
export function loadProgressDeleted(): Record<string, number> {
  return readJson<Record<string, number>>(KEYS.progressDeleted, {});
}
export function saveProgressDeleted(map: Record<string, number>) {
  writeJson(KEYS.progressDeleted, map);
}

export function loadBookmarksUpdatedAt(): number {
  return readJson<number>(KEYS.bookmarksUpdatedAt, 0);
}
export function saveBookmarksUpdatedAt(ts: number) {
  writeJson(KEYS.bookmarksUpdatedAt, ts);
}

/** False until this browser has ever saved a channel list (the demo defaults aren't the user's). */
export function hasSavedChannels(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(KEYS.channels) !== null;
  } catch {
    return false;
  }
}

export function loadChannels(): FollowedChannel[] {
  if (typeof window === "undefined") return DEFAULT_CHANNELS;
  try {
    const raw = localStorage.getItem(KEYS.channels);
    if (!raw) return DEFAULT_CHANNELS;
    const parsed = JSON.parse(raw) as FollowedChannel[];
    // An empty saved list is a real choice (the user removed everything) — don't refill defaults.
    return Array.isArray(parsed) ? parsed : DEFAULT_CHANNELS;
  } catch {
    return DEFAULT_CHANNELS;
  }
}

export function saveChannels(channels: FollowedChannel[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEYS.channels, JSON.stringify(channels));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadProgressMap(): Record<string, WatchProgress> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEYS.progress);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, WatchProgress>;
  } catch {
    return {};
  }
}

export function saveProgressMap(map: Record<string, WatchProgress>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEYS.progress, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadCredentials(): ApiCredentials {
  if (typeof window === "undefined") {
    return {
      twitchClientId: "",
      twitchClientSecret: "",
      kickClientId: "",
      kickClientSecret: "",
    };
  }
  try {
    const raw = localStorage.getItem(KEYS.credentials);
    if (!raw) {
      return {
        twitchClientId: "",
        twitchClientSecret: "",
        kickClientId: "",
        kickClientSecret: "",
      };
    }
    const parsed = JSON.parse(raw) as Partial<ApiCredentials>;
    return {
      twitchClientId: parsed.twitchClientId || "",
      twitchClientSecret: parsed.twitchClientSecret || "",
      kickClientId: parsed.kickClientId || "",
      kickClientSecret: parsed.kickClientSecret || "",
    };
  } catch {
    return {
      twitchClientId: "",
      twitchClientSecret: "",
      kickClientId: "",
      kickClientSecret: "",
    };
  }
}

export function saveCredentials(creds: ApiCredentials) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEYS.credentials, JSON.stringify(creds));
  } catch {
    // Ignore
  }
}

export function buildCredentialHeaders(creds: ApiCredentials): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (creds.twitchClientId.trim()) headers["x-twitch-client-id"] = creds.twitchClientId.trim();
  if (creds.twitchClientSecret.trim())
    headers["x-twitch-client-secret"] = creds.twitchClientSecret.trim();
  if (creds.kickClientId.trim()) headers["x-kick-client-id"] = creds.kickClientId.trim();
  if (creds.kickClientSecret.trim())
    headers["x-kick-client-secret"] = creds.kickClientSecret.trim();
  return headers;
}

export function loadEndedVods(): FeedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEYS.endedVods);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FeedItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveEndedVods(items: FeedItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEYS.endedVods, JSON.stringify(items.slice(0, 24)));
  } catch {
    // Ignore
  }
}

export function loadBookmarkedIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEYS.bookmarks);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBookmarkedIds(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEYS.bookmarks, JSON.stringify(ids));
  } catch {
    // Ignore
  }
}

export function mergeProgressMaps(
  localMap: Record<string, WatchProgress>,
  incomingMap: Record<string, WatchProgress>,
): Record<string, WatchProgress> {
  const merged: Record<string, WatchProgress> = { ...localMap };
  for (const [key, inc] of Object.entries(incomingMap)) {
    const existing = merged[key];
    if (!existing || (inc.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      merged[key] = {
        ...existing,
        ...inc,
        watched: inc.watched,
        bookmarks: existing?.bookmarks?.length ? existing.bookmarks : inc.bookmarks || [],
      };
    }
  }
  return merged;
}

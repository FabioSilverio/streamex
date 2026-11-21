/** Platforms you can sign in with (OAuth). */
export type AuthPlatform = "twitch" | "kick";
/** Platforms whose channels can be followed and watched. YouTube channels are added by hand. */
export type Platform = AuthPlatform | "youtube";

export interface FollowedChannel {
  id: string;
  platform: Platform;
  slug: string;
  displayName: string;
  avatarUrl?: string;
  addedAt: number;
  /** "twitch-follow" = imported from the connected Twitch account */
  source?: "manual" | "twitch-follow" | "kick-follow";
  /** Starred: sorted first, and the only ones that notify once any channel is starred. */
  favorite?: boolean;
  /** Last time this entry changed on any device (for cross-device sync). */
  updatedAt?: number;
}

export interface LiveChannelStatus {
  id: string;
  platform: Platform;
  slug: string;
  displayName: string;
  avatarUrl: string;
  isLive: boolean;
  title: string;
  category: string;
  viewerCount: number;
  startedAt: string | null;
  thumbnailUrl: string;
  streamId: string | null;
  playbackUrl?: string | null;
  source: "official" | "public" | "fallback";
  checkedAt: number;
}

export type FeedItemType = "live" | "vod" | "clip";

export interface FeedItem {
  id: string;
  platform: Platform;
  channelSlug: string;
  channelName: string;
  channelAvatar: string;
  type: FeedItemType;
  title: string;
  category: string;
  thumbnailUrl: string;
  durationSeconds: number;
  viewCount: number;
  createdAt: string;
  url: string;
  videoId?: string;
  clipId?: string;
  embedUrl?: string;
  hlsUrl?: string;
  isNewlyFinishedVod?: boolean;
  /** Exact broadcast start ISO timestamp (for live streams; used to track exit offset and match the resulting VOD). */
  startedAt?: string;
  /** Platform broadcast/stream id while live. */
  streamId?: string;
  tags?: string[];
  summary?: string;
}

export interface WatchBookmark {
  id: string;
  time: number;
  label: string;
  createdAt: number;
}

export interface WatchProgress {
  key: string; // e.g. "twitch:vod:12345" or "kick:live:xqc:2991234"
  platform: Platform;
  channelSlug: string;
  channelName: string;
  contentType: FeedItemType;
  videoId?: string;
  title: string;
  thumbnailUrl?: string;
  currentTime: number;
  duration: number;
  updatedAt: number;
  url: string;
  source?: "streamex" | "extension";
  bookmarks?: WatchBookmark[];
  /** ISO timestamp of when the live broadcast started (matches live checkpoint to its VOD). */
  streamStartedAt?: string;
  /** Platform stream id while live (Twitch stream id / Kick livestream id / YouTube video id). */
  streamId?: string;
  /** True when this VOD entry was automatically carried over from a live exit checkpoint. */
  fromLive?: boolean;
  /** Manually marked as watched by the user (hides from "Continuar assistindo" and shows a "Visto" badge). */
  watched?: boolean;
}

export interface ApiCredentials {
  twitchClientId: string;
  twitchClientSecret: string;
  kickClientId: string;
  kickClientSecret: string;
}

export interface ApiHealth {
  twitch: "official" | "public" | "offline";
  kick: "official" | "public" | "needs_key";
  serverHasTwitchEnv?: boolean;
  serverHasKickEnv?: boolean;
}

export interface LiveStatusResponse {
  statuses: LiveChannelStatus[];
  latencyMs: number;
  checkedAt: number;
  apiHealth: ApiHealth;
}

export interface FeedResponse {
  items: FeedItem[];
  fetchedAt: number;
  apiHealth: ApiHealth;
}

export interface ConnectedAccount {
  platform: AuthPlatform;
  userId: string;
  login: string;
  displayName: string;
  avatarUrl: string;
}

export interface AccountSession {
  twitch: ConnectedAccount | null;
  kick: ConnectedAccount | null;
  twitchLoginAvailable: boolean;
  kickLoginAvailable: boolean;
}

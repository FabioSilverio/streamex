"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  Bell,
  BellRing,
  LayoutGrid,
  PanelLeft,
  Puzzle,
  Radio,
  RefreshCw,
  Search,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type {
  AccountSession,
  ApiCredentials,
  ApiHealth,
  FeedItem,
  FeedResponse,
  FollowedChannel,
  LiveChannelStatus,
  LiveStatusResponse,
  Platform,
  WatchProgress,
} from "@/types/streamex";
import {
  buildProgressKey,
  channelUrl,
  cn,
  DEFAULT_CHANNELS,
  EASE_OUT,
  getExternalPlatformUrl,
} from "@/lib/utils";
import {
  buildCredentialHeaders,
  loadBookmarkedIds,
  loadChannels,
  loadCredentials,
  loadEndedVods,
  hasSavedChannels,
  loadBookmarksUpdatedAt,
  loadHiddenChannelIds,
  loadHiddenMap,
  loadProgressDeleted,
  loadProgressMap,
  mergeProgressMaps,
  saveBookmarkedIds,
  saveChannels,
  saveCredentials,
  saveEndedVods,
  saveBookmarksUpdatedAt,
  saveHiddenMap,
  saveProgressDeleted,
  saveProgressMap,
} from "@/lib/storage";
import {
  findLiveCheckpointForBroadcast,
  isWatchedVod,
  promoteLiveCheckpointsToVods,
  pruneProgressMap,
} from "@/lib/progress";
import { loadTwitchSdk } from "@/lib/twitch-sdk";
import { loadYouTubeSdk } from "@/lib/youtube-sdk";
import { mergeSyncState, type SyncState } from "@/lib/sync-merge";
import { playerSelector, thumbSelector, transition } from "@/lib/view-transition";
import { StreamexLogo } from "@/components/StreamexLogo";
import { LiveSidebar, TopLiveStrip } from "@/components/LiveRadarBar";
import { FeedGrid, type FeedTab } from "@/components/FeedGrid";
import { ChannelView } from "@/components/ChannelView";
import { TheaterView } from "@/components/TheaterView";
import { ChannelsModal } from "@/components/ChannelsModal";
import { ApiSettingsModal } from "@/components/ApiSettingsModal";
import { ExtensionModal } from "@/components/ExtensionModal";
import { MULTI_MAX, MultiView, type MultiItem } from "@/components/MultiView";
import { Ticker } from "@/components/Ticker";

interface ToastAlert {
  id: string;
  title: string;
  subtitle: string;
  platform?: Platform;
  actionItem?: FeedItem;
}

const POLL_MS = 2000;
/** While the tab is hidden the radar keeps running (for notifications), just slower. */
const HIDDEN_POLL_MS = 30_000;
const NOTIFY_KEY = "streamex:notify:v1";
const BASE_TITLE = "Streamex — Twitch e Kick num lugar só";
/** Push local changes this long after the last edit (progress saves every 5s while watching). */
const SYNC_DEBOUNCE_MS = 8000;
/** Pull changes made on other devices while this tab is open. */
const SYNC_INTERVAL_MS = 60_000;

export interface SyncInfo {
  status: "off" | "syncing" | "ok" | "error";
  at: number | null;
}

const syncSignature = (st: SyncState) =>
  JSON.stringify([
    st.channels,
    st.hidden,
    st.progress,
    st.progressDeleted,
    st.bookmarks,
    st.bookmarksUpdatedAt,
  ]);
const TWITCH_SYNC_KEY = "streamex:twitch-sync:v1";
const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000;

const EMPTY_SESSION: AccountSession = {
  twitch: null,
  kick: null,
  twitchLoginAvailable: false,
  kickLoginAvailable: false,
};

const AUTH_ERRORS: Record<string, string> = {
  missing_env: "As chaves da plataforma não estão configuradas na Vercel.",
  denied: "Você cancelou a autorização.",
  state: "A sessão de login expirou. Tente de novo.",
  token: "A plataforma recusou o código. Confira a URL de redirecionamento do app.",
  profile: "Não deu para ler o perfil da conta.",
};

function readLastSync(): number | null {
  try {
    const v = Number(localStorage.getItem(TWITCH_SYNC_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function liveItemFromStatus(s: LiveChannelStatus, title?: string): FeedItem {
  return {
    id: `live:${s.platform}:${s.slug}`,
    platform: s.platform,
    channelSlug: s.slug,
    channelName: s.displayName,
    channelAvatar: s.avatarUrl,
    type: "live",
    title: title || s.title || `${s.displayName} está ao vivo`,
    category: s.category || (s.isLive ? "Ao vivo" : "Offline"),
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
    // YouTube lives are played by video id
    videoId: s.platform === "youtube" ? (s.streamId ?? undefined) : undefined,
    hlsUrl: s.playbackUrl || undefined,
  };
}

export function StreamexApp() {
  const [hydrated, setHydrated] = useState(false);
  const [channels, setChannels] = useState<FollowedChannel[]>(DEFAULT_CHANNELS);
  const [credentials, setCredentials] = useState<ApiCredentials>({
    twitchClientId: "",
    twitchClientSecret: "",
    kickClientId: "",
    kickClientSecret: "",
  });
  const [session, setSession] = useState<AccountSession>(EMPTY_SESSION);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const [statuses, setStatuses] = useState<LiveChannelStatus[]>([]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [endedVods, setEndedVods] = useState<FeedItem[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, WatchProgress>>({});
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>([]);

  const [apiHealth, setApiHealth] = useState<ApiHealth>({ twitch: "public", kick: "needs_key" });
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [pollTick, setPollTick] = useState<number>(0);
  const [loadingFeed, setLoadingFeed] = useState<boolean>(true);

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<FeedTab>("all");
  const [platformFilter, setPlatformFilter] = useState<"all" | Platform>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeWatchItem, setActiveWatchItem] = useState<FeedItem | null>(null);
  const [pipMode, setPipMode] = useState<boolean>(false);
  const [selectedChannel, setSelectedChannel] = useState<LiveChannelStatus | null>(null);
  const [channelItemsCache, setChannelItemsCache] = useState<Record<string, FeedItem[]>>({});
  const [loadingChannelKey, setLoadingChannelKey] = useState<string | null>(null);

  const [channelsModalOpen, setChannelsModalOpen] = useState(false);
  const [apiModalOpen, setApiModalOpen] = useState(false);
  const [extensionModalOpen, setExtensionModalOpen] = useState(false);
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [toasts, setToasts] = useState<ToastAlert[]>([]);
  const [shortcutLabel, setShortcutLabel] = useState("Ctrl K");
  const [multiItems, setMultiItems] = useState<MultiItem[]>([]);
  const [multiOpen, setMultiOpen] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const prevLiveMapRef = useRef<Map<string, LiveChannelStatus>>(new Map());
  const firstPollDoneRef = useRef<boolean>(false);
  const activeItemRef = useRef<FeedItem | null>(null);
  const pipModeRef = useRef(false);
  const feedScrollRef = useRef(0);
  const channelFetchSeqRef = useRef(0);
  const channelsRef = useRef(channels);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);
  useEffect(() => {
    activeItemRef.current = activeWatchItem;
    pipModeRef.current = pipMode;
  }, [activeWatchItem, pipMode]);

  // Effects that fetch per channel depend on *which* channels exist, not on the array object,
  // so starring a channel (or refreshing an avatar) doesn't refetch the feed or restart the radar.
  const channelKey = useMemo(
    () =>
      channels
        .map((c) => c.id)
        .sort()
        .join(","),
    [channels],
  );

  const favoriteIds = useMemo(
    () => new Set(channels.filter((c) => c.favorite).map((c) => c.id)),
    [channels],
  );
  // The 2s poll reads these through refs so toggling them never restarts the radar.
  const favoriteIdsRef = useRef(favoriteIds);
  const notifyRef = useRef(notifyEnabled);
  useEffect(() => {
    favoriteIdsRef.current = favoriteIds;
    notifyRef.current = notifyEnabled;
  }, [favoriteIds, notifyEnabled]);

  const pushToast = useCallback((toast: Omit<ToastAlert, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [{ ...toast, id }, ...prev].slice(0, 3));
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6500);
  }, []);

  const handleUpdateChannels = useCallback((incoming: FollowedChannel[]) => {
    // Channels the user removes are remembered (with when), so the next Twitch/Kick follow sync —
    // or another device — doesn't silently add them back. Re-adding one by hand clears it.
    const now = Date.now();
    const prevById = new Map(channelsRef.current.map((c) => [c.id, c]));
    const next = incoming.map((c) => {
      const prev = prevById.get(c.id);
      // Only user intent counts as a change (adding, starring). A refreshed name/avatar from a
      // follow import must not look "newer" than a removal made on another device.
      const changed = !prev || Boolean(prev.favorite) !== Boolean(c.favorite);
      return changed && c.updatedAt === prev?.updatedAt ? { ...c, updatedAt: now } : c;
    });
    const nextIds = new Set(next.map((c) => c.id));
    const hidden = loadHiddenMap();
    for (const c of channelsRef.current) if (!nextIds.has(c.id)) hidden[c.id] = now;
    for (const c of next) if (c.source === "manual" && !prevById.has(c.id)) delete hidden[c.id];
    saveHiddenMap(hidden);
    channelsRef.current = next;
    setChannels(next);
    saveChannels(next);
  }, []);

  // Kick has no official "followed channels" API; the extension reads it on kick.com and posts it here.
  const mergeKickFollows = useCallback(
    (list: Array<{ slug: string; displayName: string; avatarUrl?: string }>) => {
      const current = channelsRef.current;
      const existing = new Set([...current.map((c) => c.id), ...loadHiddenChannelIds()]);
      const added: FollowedChannel[] = list
        .filter((c) => c.slug && !existing.has(`kick:${c.slug.toLowerCase()}`))
        .map((c) => ({
          id: `kick:${c.slug.toLowerCase()}`,
          platform: "kick" as const,
          slug: c.slug.toLowerCase(),
          displayName: c.displayName || c.slug,
          avatarUrl: c.avatarUrl || undefined,
          addedAt: Date.now(),
          source: "kick-follow" as const,
        }));
      if (added.length === 0) return;
      handleUpdateChannels([...current, ...added]);
      pushToast({
        title: "Canais da Kick importados",
        subtitle: `${added.length} ${added.length === 1 ? "canal novo" : "canais novos"} que você segue`,
        platform: "kick",
      });
    },
    [handleUpdateChannels, pushToast],
  );

  // ---------- Cross-device sync ----------
  const [syncInfo, setSyncInfo] = useState<SyncInfo>({ status: "off", at: null });
  const progressRef = useRef(progressMap);
  const feedItemsRef = useRef(feedItems);
  const statusesRef = useRef(statuses);
  const bookmarksRef = useRef(bookmarkedIds);
  const signedInRef = useRef(false);
  const lastSyncSigRef = useRef("");
  const syncingRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const syncNowRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    progressRef.current = progressMap;
    bookmarksRef.current = bookmarkedIds;
  }, [progressMap, bookmarkedIds]);
  useEffect(() => {
    feedItemsRef.current = feedItems;
    statusesRef.current = statuses;
  }, [feedItems, statuses]);

  const promoteLiveToVod = useCallback(
    (
      items: FeedItem[],
      liveStatuses: LiveChannelStatus[],
      baseMap?: Record<string, WatchProgress>,
    ) => {
      const source = baseMap ?? progressRef.current;
      const { next, changed, promoted } = promoteLiveCheckpointsToVods(
        source,
        items,
        liveStatuses,
        loadProgressDeleted(),
      );
      if (!changed) return source;
      progressRef.current = next;
      setProgressMap(next);
      saveProgressMap(next);
      for (const entry of promoted) {
        window.postMessage({ type: "STREAMEX_WEB_SAVE_PROGRESS", entry }, "*");
      }
      return next;
    },
    [],
  );

  const buildLocalSyncState = useCallback(
    (): SyncState => ({
      // A browser that never saved a list only has the demo channels — don't push those.
      channels: hasSavedChannels() ? channelsRef.current : [],
      hidden: loadHiddenMap(),
      progress: progressRef.current,
      progressDeleted: loadProgressDeleted(),
      bookmarks: bookmarksRef.current,
      bookmarksUpdatedAt: loadBookmarksUpdatedAt(),
    }),
    [],
  );

  const applySyncState = useCallback((st: SyncState) => {
    if (st.channels.length > 0 || hasSavedChannels()) {
      channelsRef.current = st.channels;
      setChannels(st.channels);
      saveChannels(st.channels);
    }
    saveHiddenMap(st.hidden);
    const promotedMap = promoteLiveToVod(feedItemsRef.current, statusesRef.current, st.progress);
    progressRef.current = promotedMap;
    setProgressMap(promotedMap);
    saveProgressMap(promotedMap);
    saveProgressDeleted(st.progressDeleted);
    bookmarksRef.current = st.bookmarks;
    setBookmarkedIds(st.bookmarks);
    saveBookmarkedIds(st.bookmarks);
    saveBookmarksUpdatedAt(st.bookmarksUpdatedAt);
  }, [promoteLiveToVod]);

  const syncNow = useCallback(async () => {
    if (!signedInRef.current) return;
    if (syncingRef.current) {
      syncQueuedRef.current = true;
      return;
    }
    syncingRef.current = true;
    setSyncInfo((s) => ({ ...s, status: "syncing" }));
    try {
      const sent = buildLocalSyncState();
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sent),
        cache: "no-store",
      });
      if (res.status === 503 || res.status === 401) {
        setSyncInfo({ status: "off", at: null });
        return;
      }
      if (!res.ok) throw new Error(`sync ${res.status}`);
      const data = (await res.json()) as { state: SyncState; syncedAt: number };
      // Edits made while the request was in flight are merged on top, then pushed next round.
      const current = buildLocalSyncState();
      const final = mergeSyncState(current, data.state);
      applySyncState(final);
      lastSyncSigRef.current = syncSignature(final);
      if (syncSignature(current) !== syncSignature(sent)) syncQueuedRef.current = true;
      setSyncInfo({ status: "ok", at: data.syncedAt });
    } catch {
      setSyncInfo((s) => ({ ...s, status: "error" }));
    } finally {
      syncingRef.current = false;
      if (syncQueuedRef.current) {
        syncQueuedRef.current = false;
        window.setTimeout(() => syncNowRef.current(), 1500);
      }
    }
  }, [applySyncState, buildLocalSyncState]);
  useEffect(() => {
    syncNowRef.current = syncNow;
  }, [syncNow]);

  // ---------- Accounts ----------
  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok) return EMPTY_SESSION;
      const data = (await res.json()) as AccountSession;
      setSession(data);
      return data;
    } catch {
      return EMPTY_SESSION;
    }
  }, []);

  const syncTwitchFollows = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      setSyncing(true);
      setSyncMessage(null);
      try {
        const res = await fetch("/api/follows/twitch", { cache: "no-store" });
        if (res.status === 401) {
          setSession((s) => ({ ...s, twitch: null }));
          setSyncMessage("Sessão expirada — conecte de novo.");
          return;
        }
        if (!res.ok) {
          setSyncMessage("A Twitch não respondeu. Tente de novo.");
          return;
        }
        const data = (await res.json()) as { channels: FollowedChannel[]; syncedAt: number };
        const current = channelsRef.current;
        const byId = new Map(data.channels.map((c) => [c.id, c]));
        // Keep everything already there (refresh name/avatar for follows), then append new follows.
        const updated = current.map((c) => {
          const f = byId.get(c.id);
          return f
            ? {
                ...c,
                displayName: f.displayName,
                avatarUrl: f.avatarUrl || c.avatarUrl,
                source: c.source ?? f.source,
              }
            : c;
        });
        const existing = new Set([...current.map((c) => c.id), ...loadHiddenChannelIds()]);
        const added = data.channels.filter((c) => !existing.has(c.id));
        handleUpdateChannels([...updated, ...added]);

        setLastSyncAt(data.syncedAt);
        try {
          localStorage.setItem(TWITCH_SYNC_KEY, String(data.syncedAt));
        } catch {
          // ignore
        }
        const msg =
          added.length > 0
            ? `${added.length} ${added.length === 1 ? "canal novo" : "canais novos"} de ${data.channels.length} seguidos`
            : `Tudo em dia · ${data.channels.length} seguidos`;
        setSyncMessage(msg);
        if (!opts.silent || added.length > 0) {
          pushToast({ title: "Canais da Twitch importados", subtitle: msg, platform: "twitch" });
        }
      } catch {
        setSyncMessage("Falha de rede ao importar.");
      } finally {
        setSyncing(false);
      }
    },
    [handleUpdateChannels, pushToast],
  );

  const handleDisconnect = useCallback(async (platform: Platform) => {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform }),
    }).catch(() => null);
    setSession((s) => ({ ...s, [platform]: null }));
    if (platform === "twitch") setSyncMessage(null);
  }, []);

  // Hydrate persisted state, then session + OAuth return params
  /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from localStorage */
  useEffect(() => {
    setChannels(loadChannels());
    setCredentials(loadCredentials());
    const pruned = pruneProgressMap(loadProgressMap());
    saveProgressMap(pruned);
    setProgressMap(pruned);
    // Placeholders older than a day are stale; keep one per channel (older builds could duplicate them).
    const seenEnded = new Set<string>();
    setEndedVods(
      loadEndedVods().filter((v) => {
        const key = `${v.platform}:${v.channelSlug}`;
        if (Date.now() - new Date(v.createdAt).getTime() > 24 * 3600 * 1000 || seenEnded.has(key))
          return false;
        seenEnded.add(key);
        return true;
      }),
    );
    setBookmarkedIds(loadBookmarkedIds());
    setLastSyncAt(readLastSync());
    setShortcutLabel(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K");
    try {
      setNotifyEnabled(
        localStorage.getItem(NOTIFY_KEY) === "1" &&
          "Notification" in window &&
          Notification.permission === "granted",
      );
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const authError = params.get("auth_error");
    if (connected || authError) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from props/browser state
    refreshSession().then((s) => {
      if (authError) {
        const [platform, ...rest] = authError.split("_");
        pushToast({
          title: `Não foi possível conectar a ${platform === "kick" ? "Kick" : "Twitch"}`,
          subtitle: AUTH_ERRORS[rest.join("_")] ?? "Tente de novo em instantes.",
          platform: platform === "kick" ? "kick" : "twitch",
        });
        setApiModalOpen(true);
      }
      if (connected === "kick" && s.kick) {
        pushToast({
          title: `Kick conectada · @${s.kick.login}`,
          subtitle: "Conta vinculada ao Streamex.",
          platform: "kick",
        });
      }
      if (s.twitch) {
        const last = readLastSync();
        if (connected === "twitch" || !last || Date.now() - last > AUTO_SYNC_AFTER_MS) {
          syncTwitchFollows({ silent: connected !== "twitch" });
        }
      }
    });
  }, [hydrated, refreshSession, syncTwitchFollows, pushToast]);

  // Cmd/Ctrl + K focuses search (instant — keyboard actions never animate)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Chrome extension sync bridge
  useEffect(() => {
    if (!hydrated) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || !event.data || typeof event.data !== "object") return;
      const msg = event.data as {
        type?: string;
        progressMap?: Record<string, WatchProgress>;
        channels?: Array<{ slug: string; displayName: string; avatarUrl?: string }>;
      };
      if (msg.type === "STREAMEX_EXT_KICK_FOLLOWS" && Array.isArray(msg.channels)) {
        mergeKickFollows(msg.channels);
        return;
      }
      if (msg.type === "STREAMEX_EXT_PONG" || msg.type === "STREAMEX_EXT_SYNC") {
        setExtensionConnected(true);
        if (msg.progressMap && typeof msg.progressMap === "object") {
          setProgressMap((prev) => {
            const merged = mergeProgressMaps(prev, msg.progressMap!);
            saveProgressMap(merged);
            return merged;
          });
        }
      }
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "STREAMEX_WEB_PING" }, "*");
    const retryPing = window.setTimeout(
      () => window.postMessage({ type: "STREAMEX_WEB_PING" }, "*"),
      1200,
    );
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(retryPing);
    };
  }, [hydrated, mergeKickFollows]);

  // ---------- Feed (live + VODs + clips) ----------
  const feedSeqRef = useRef(0);
  const refreshFeed = useCallback(async (chs: FollowedChannel[], creds: ApiCredentials) => {
    // A slow response for an older channel list must not overwrite a newer one.
    const seq = ++feedSeqRef.current;
    try {
      const res = await fetch("/api/feed", {
        method: "POST",
        headers: buildCredentialHeaders(creds),
        body: JSON.stringify({ channels: chs }),
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as FeedResponse;
      if (seq !== feedSeqRef.current) return;
      const items = data.items ?? [];
      feedItemsRef.current = items;
      setFeedItems(items);
      promoteLiveToVod(items, statusesRef.current);
      if (data.apiHealth) setApiHealth(data.apiHealth);
    } catch {
      // keep previous feed
    } finally {
      if (seq === feedSeqRef.current) setLoadingFeed(false);
    }
  }, [promoteLiveToVod]);

  useEffect(() => {
    if (!hydrated) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from props/browser state
    setLoadingFeed(true);
    refreshFeed(channelsRef.current, credentials);
    const periodicFeed = window.setInterval(() => {
      if (!document.hidden) refreshFeed(channelsRef.current, credentials);
    }, 45_000);
    return () => window.clearInterval(periodicFeed);
  }, [hydrated, channelKey, credentials, refreshFeed]);

  // Warm the player while the phone is idle, so tapping a video starts fast:
  // hls.js (desktop Kick playback), Twitch's player SDK, and YouTube's if you follow YouTube.
  useEffect(() => {
    if (!hydrated || loadingFeed) return;
    const idle =
      (window as Window & { requestIdleCallback?: (cb: () => void) => number })
        .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => {
      import("hls.js").catch(() => undefined);
      loadTwitchSdk().catch(() => undefined);
      if (channelsRef.current.some((c) => c.platform === "youtube")) {
        loadYouTubeSdk().catch(() => undefined);
      }
    });
  }, [hydrated, loadingFeed]);

  // ---------- 2s live radar (paused while the tab is hidden) ----------
  useEffect(() => {
    if (!hydrated) return;

    let cancelled = false;
    let timerId: number | null = null;
    let inFlight = false;
    let activeController: AbortController | null = null;

    const schedule = () => {
      if (cancelled) return;
      if (timerId) window.clearTimeout(timerId);
      timerId = window.setTimeout(pollOnce, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
    };

    // Coming back to the tab: refresh right away instead of waiting out the slow hidden interval.
    const onVisibility = () => {
      if (!document.hidden && !inFlight) {
        if (timerId) window.clearTimeout(timerId);
        pollOnce();
      }
    };

    const pollOnce = async () => {
      if (cancelled) return;
      inFlight = true;
      activeController = new AbortController();
      const t0 = performance.now();

      try {
        const res = await fetch("/api/live-status", {
          method: "POST",
          headers: buildCredentialHeaders(credentials),
          body: JSON.stringify({ channels: channelsRef.current }),
          cache: "no-store",
          signal: activeController.signal,
        });

        if (res.ok && !cancelled) {
          const data = (await res.json()) as LiveStatusResponse;
          const prevMap = prevLiveMapRef.current;
          // A failed lookup ("fallback") means "unknown", not "offline" — keep the last known state
          // so a flaky request never fires fake "went live" / "new VOD" alerts.
          const incoming = (data.statuses ?? []).map((st) =>
            st.source === "fallback" ? (prevMap.get(st.id) ?? st) : st,
          );
          statusesRef.current = incoming;
          setStatuses(incoming);
          promoteLiveToVod(feedItemsRef.current, incoming);
          setLatencyMs(Math.max(data.latencyMs || 1, Math.round(performance.now() - t0)));
          setPollTick((n) => n + 1);
          if (data.apiHealth) setApiHealth(data.apiHealth);

          const nextMap = new Map<string, LiveChannelStatus>();
          let anyEnded = false;

          for (const st of incoming) {
            nextMap.set(st.id, st);
            const prev = prevMap.get(st.id);
            if (!firstPollDoneRef.current || !prev) continue;

            // With favorites set, only they alert; otherwise every followed channel does.
            const favs = favoriteIdsRef.current;
            const alerts = favs.size === 0 || favs.has(st.id);
            if (!prev.isLive && st.isLive && alerts) {
              const liveItem = liveItemFromStatus(st);
              pushToast({
                title: `${st.displayName} entrou ao vivo`,
                subtitle: st.title || st.category || "Toque para assistir",
                platform: st.platform,
                actionItem: liveItem,
              });
              if (
                notifyRef.current &&
                document.hidden &&
                "Notification" in window &&
                Notification.permission === "granted"
              ) {
                try {
                  const n = new Notification(`${st.displayName} entrou ao vivo`, {
                    body: st.title || st.category || "",
                    icon: st.avatarUrl.startsWith("data:") ? undefined : st.avatarUrl,
                    tag: `live:${st.id}`,
                  });
                  n.onclick = () => {
                    window.focus();
                    activeItemRef.current = liveItem;
                    pipModeRef.current = false;
                    setMultiOpen(false);
                    setSelectedChannel(null);
                    setPipMode(false);
                    setActiveWatchItem(liveItem);
                    n.close();
                  };
                } catch {
                  // some browsers only allow notifications from a service worker
                }
              }
            }

            if (prev.isLive && !st.isLive) {
              anyEnded = true;
              const endedDuration = prev.startedAt
                ? Math.max(60, Math.floor((Date.now() - new Date(prev.startedAt).getTime()) / 1000))
                : 0;
              const freshVod: FeedItem = {
                id: `ended-vod:${prev.platform}:${prev.slug}:${Date.now()}`,
                platform: prev.platform,
                channelSlug: prev.slug,
                channelName: prev.displayName,
                channelAvatar: prev.avatarUrl,
                type: "vod",
                title: prev.title || `VOD recém-encerrado de ${prev.displayName}`,
                category: prev.category || "VOD recém-encerrado",
                thumbnailUrl: prev.thumbnailUrl,
                durationSeconds: endedDuration,
                viewCount: prev.viewerCount,
                createdAt: new Date().toISOString(),
                url:
                  prev.platform === "kick"
                    ? `https://kick.com/${prev.slug}/videos`
                    : prev.platform === "youtube"
                      ? `https://www.youtube.com/channel/${prev.slug}/streams`
                      : `https://www.twitch.tv/${prev.slug}/videos?filter=archives`,
                isNewlyFinishedVod: true,
              };
              setEndedVods((cur) => {
                const next = [
                  freshVod,
                  ...cur.filter(
                    (v) => !(v.platform === prev.platform && v.channelSlug === prev.slug),
                  ),
                ].slice(0, 20);
                saveEndedVods(next);
                return next;
              });
              if (alerts) {
                pushToast({
                  title: `Novo VOD · ${prev.displayName}`,
                  subtitle: "A live acabou e já está nos seus VODs.",
                  platform: prev.platform,
                  actionItem: freshVod,
                });
              }
            }
          }

          prevLiveMapRef.current = nextMap;
          firstPollDoneRef.current = true;
          if (anyEnded) refreshFeed(channelsRef.current, credentials);
        }
      } catch {
        // transient network abort
      } finally {
        inFlight = false;
        schedule();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    pollOnce();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerId) window.clearTimeout(timerId);
      activeController?.abort();
    };
  }, [hydrated, channelKey, credentials, pushToast, refreshFeed, promoteLiveToVod]);

  // Merge live statuses (2s fresh) + feed VODs/clips + locally detected ended VODs
  const mergedFeedItems = useMemo(() => {
    const liveFromRadar = statuses.filter((s) => s.isLive).map((s) => liveItemFromStatus(s));
    const nonLiveFeed = feedItems.filter((i) => i.type !== "live");
    // A locally detected "live just ended" card is a placeholder until the platform publishes the
    // real VOD (which starts at the broadcast start, i.e. before the placeholder's timestamp).
    const followed = new Set(channels.map((c) => `${c.platform}:${c.slug}`));
    const pendingEnded = endedVods.filter((e) => {
      if (!followed.has(`${e.platform}:${e.channelSlug}`)) return false;
      const endedAt = new Date(e.createdAt).getTime();
      return !nonLiveFeed.some(
        (v) =>
          v.type === "vod" &&
          v.platform === e.platform &&
          v.channelSlug === e.channelSlug &&
          endedAt - new Date(v.createdAt).getTime() < 36 * 3600 * 1000 &&
          endedAt - new Date(v.createdAt).getTime() > -3600 * 1000,
      );
    });
    const seen = new Set<string>();
    const combined: FeedItem[] = [];
    for (const item of [...liveFromRadar, ...pendingEnded, ...nonLiveFeed]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      combined.push(item);
    }
    return combined;
  }, [statuses, feedItems, endedVods, channels]);

  // ---------- Handlers ----------
  // Opening a card morphs its thumbnail into the player (and back), and returning to the feed
  // restores where you were scrolled instead of jumping to the top.
  const expandFromPip = useCallback(() => {
    if (!activeItemRef.current || !pipModeRef.current) return;
    feedScrollRef.current = window.scrollY;
    pipModeRef.current = false;
    transition(
      () => {
        setMultiOpen(false);
        setPipMode(false);
      },
      {
        after: () => window.scrollTo({ top: 0 }),
        from: () => document.querySelector(playerSelector),
        to: () => document.querySelector(playerSelector),
      },
    );
  }, []);

  const openItem = useCallback(
    (item: FeedItem | null) => {
      const prev = activeItemRef.current;
      const wasPip = pipModeRef.current;
      // Clicking the same video that's already playing in PiP smoothly expands it instead of restarting.
      if (item && prev && item.id === prev.id && wasPip) {
        expandFromPip();
        return;
      }
      if (item && (!prev || wasPip)) feedScrollRef.current = window.scrollY;
      activeItemRef.current = item;
      pipModeRef.current = false;
      transition(
        () => {
          setMultiOpen(false);
          setPipMode(false);
          setActiveWatchItem(item);
        },
        {
          after: () => window.scrollTo({ top: item ? 0 : feedScrollRef.current }),
          from: () =>
            document.querySelector(
              item && (!prev || wasPip) ? thumbSelector(item.id) : playerSelector,
            ),
          to: () =>
            item
              ? document.querySelector(playerSelector)
              : prev
                ? document.querySelector(thumbSelector(prev.id))
                : null,
        },
      );
    },
    [expandFromPip],
  );

  const minimizeToPip = useCallback(() => {
    if (!activeItemRef.current || pipModeRef.current) return;
    pipModeRef.current = true;
    transition(
      () => {
        setPipMode(true);
      },
      {
        after: () => window.scrollTo({ top: feedScrollRef.current }),
        from: () => document.querySelector(playerSelector),
        to: () => document.querySelector(playerSelector),
      },
    );
  }, []);

  // Keyboard shortcut: P toggles full theater ↔ floating PiP mini-player
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "p") return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (!activeItemRef.current) return;
      e.preventDefault();
      if (pipModeRef.current) expandFromPip();
      else minimizeToPip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandFromPip, minimizeToPip]);

  const loadChannelVideos = useCallback(
    async (ch: LiveChannelStatus) => {
      const seq = ++channelFetchSeqRef.current;
      const key = `${ch.platform}:${ch.slug.toLowerCase()}`;
      setLoadingChannelKey(key);
      try {
        const followed = channelsRef.current.find(
          (c) => c.platform === ch.platform && c.slug.toLowerCase() === ch.slug.toLowerCase(),
        ) ?? {
          id: ch.id,
          platform: ch.platform,
          slug: ch.slug,
          displayName: ch.displayName,
          avatarUrl: ch.avatarUrl,
          addedAt: Date.now(),
        };
        const res = await fetch("/api/feed", {
          method: "POST",
          headers: buildCredentialHeaders(credentials),
          body: JSON.stringify({ channels: [followed], perChannelLimit: 16 }),
          cache: "no-store",
        });
        if (!res.ok || seq !== channelFetchSeqRef.current) return;
        const data = (await res.json()) as FeedResponse;
        const items = data.items ?? [];
        setChannelItemsCache((prev) => ({ ...prev, [key]: items }));
        promoteLiveToVod(items, statusesRef.current);
      } catch {
        // keep cached/feed items
      } finally {
        if (seq === channelFetchSeqRef.current) setLoadingChannelKey(null);
      }
    },
    [credentials, promoteLiveToVod],
  );

  const openChannelPage = useCallback(
    (ch: LiveChannelStatus) => {
      const wasWatchingFull = Boolean(activeItemRef.current && !pipModeRef.current);
      if (wasWatchingFull) pipModeRef.current = true;
      transition(
        () => {
          setMultiOpen(false);
          if (wasWatchingFull) setPipMode(true);
          setSelectedChannel(ch);
        },
        {
          after: () => window.scrollTo({ top: 0 }),
          from: wasWatchingFull ? () => document.querySelector(playerSelector) : undefined,
          to: wasWatchingFull ? () => document.querySelector(playerSelector) : undefined,
        },
      );
      loadChannelVideos(ch);
    },
    [loadChannelVideos],
  );

  const toggleFavorite = (id: string) => {
    handleUpdateChannels(
      channelsRef.current.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)),
    );
  };

  const multiIds = useMemo(() => multiItems.map((m) => m.id), [multiItems]);

  const addToMulti = (item: FeedItem, open: boolean) => {
    if (item.type !== "live") return;
    if (!multiItems.some((m) => m.id === item.id)) {
      if (multiItems.length >= MULTI_MAX) {
        pushToast({
          title: "Multistream cheio",
          subtitle: `Tire uma live para adicionar outra (máx. ${MULTI_MAX}).`,
        });
        if (!open) return;
      } else {
        // Only the first stream starts with sound; decided now so its iframe never reloads.
        setMultiItems((cur) => [...cur, { ...item, startMuted: cur.length > 0 }]);
        if (!open) {
          pushToast({
            title: `${item.channelName} no multistream`,
            subtitle: `${multiItems.length + 1} de ${MULTI_MAX} · abra pelo botão Multi no topo`,
            platform: item.platform,
          });
        }
      }
    }
    if (open) {
      activeItemRef.current = null;
      pipModeRef.current = false;
      transition(() => {
        setActiveWatchItem(null);
        setPipMode(false);
        setSelectedChannel(null);
        setMultiOpen(true);
        window.scrollTo({ top: 0 });
      });
    }
  };

  const toggleNotifications = async () => {
    if (notifyEnabled) {
      setNotifyEnabled(false);
      try {
        localStorage.setItem(NOTIFY_KEY, "0");
      } catch {
        // ignore
      }
      pushToast({
        title: "Notificações desligadas",
        subtitle: "Os avisos aparecem só aqui dentro do site.",
      });
      return;
    }
    if (!("Notification" in window)) {
      pushToast({
        title: "Sem suporte",
        subtitle: "Este navegador não tem notificações do sistema.",
      });
      return;
    }
    const permission =
      Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      pushToast({
        title: "Notificações bloqueadas",
        subtitle: "Libere em 🔒 ao lado do endereço do site → Notificações.",
      });
      return;
    }
    setNotifyEnabled(true);
    try {
      localStorage.setItem(NOTIFY_KEY, "1");
    } catch {
      // ignore
    }
    pushToast({
      title: "Notificações ligadas",
      subtitle:
        favoriteIds.size > 0
          ? "Você recebe aviso quando um favorito ★ entrar ao vivo."
          : "Você recebe aviso quando qualquer canal entrar ao vivo. Favorite ★ para filtrar.",
    });
  };

  const handleSaveCredentials = (next: ApiCredentials) => {
    setCredentials(next);
    saveCredentials(next);
  };

  const handleSaveProgress = useCallback((update: WatchProgress) => {
    setProgressMap((prev) => {
      const next = { ...prev, [update.key]: update };
      progressRef.current = next;
      saveProgressMap(next);
      return next;
    });
    if (update.contentType === "vod") {
      window.postMessage({ type: "STREAMEX_WEB_SAVE_PROGRESS", entry: update }, "*");
    }
  }, []);

  const handleRemoveProgress = (key: string) => {
    saveProgressDeleted({ ...loadProgressDeleted(), [key]: Date.now() });
    setProgressMap((prev) => {
      const next = { ...prev };
      delete next[key];
      progressRef.current = next;
      saveProgressMap(next);
      return next;
    });
    window.postMessage({ type: "STREAMEX_WEB_DELETE_PROGRESS", key }, "*");
  };

  const handleMarkProgressWatched = useCallback((prog: WatchProgress) => {
    const updated: WatchProgress = {
      ...prog,
      watched: true,
      currentTime: prog.duration > 0 ? prog.duration : Math.max(prog.currentTime, 1),
      updatedAt: Date.now(),
    };
    setProgressMap((prev) => {
      const next = { ...prev, [prog.key]: updated };
      progressRef.current = next;
      saveProgressMap(next);
      return next;
    });
    window.postMessage({ type: "STREAMEX_WEB_SAVE_PROGRESS", entry: updated }, "*");
    pushToast({
      title: "Marcado como visto",
      subtitle: prog.title,
      platform: prog.platform,
    });
  }, [pushToast]);

  const handleToggleWatched = useCallback(
    (item: FeedItem) => {
      if (item.type !== "vod") return;
      const key = buildProgressKey(item);
      const existing = progressRef.current[key];
      const alreadyWatched = isWatchedVod(existing);
      const updated: WatchProgress = {
        key,
        platform: item.platform,
        channelSlug: item.channelSlug,
        channelName: item.channelName,
        contentType: "vod",
        videoId: item.videoId,
        title: item.title,
        thumbnailUrl: item.thumbnailUrl || existing?.thumbnailUrl,
        currentTime: alreadyWatched
          ? 0
          : item.durationSeconds > 0
            ? item.durationSeconds
            : Math.max(existing?.currentTime ?? 0, 1),
        duration: item.durationSeconds || existing?.duration || 0,
        updatedAt: Date.now(),
        url: getExternalPlatformUrl(item, 0),
        source: "streamex",
        bookmarks: existing?.bookmarks ?? [],
        watched: !alreadyWatched,
      };
      setProgressMap((prev) => {
        const next = { ...prev, [key]: updated };
        progressRef.current = next;
        saveProgressMap(next);
        return next;
      });
      window.postMessage({ type: "STREAMEX_WEB_SAVE_PROGRESS", entry: updated }, "*");
    },
    [],
  );

  const handleToggleBookmark = (itemId: string) => {
    setBookmarkedIds((prev) => {
      const next = prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [itemId, ...prev];
      saveBookmarkedIds(next);
      saveBookmarksUpdatedAt(Date.now());
      return next;
    });
  };

  const handleSelectChannelFromRadar = (ch: LiveChannelStatus) => {
    // Live channels open straight in the player; offline channels open their VODs/videos page.
    if (!ch.isLive) {
      openChannelPage(ch);
      return;
    }
    const existingLive = mergedFeedItems.find(
      (i) => i.type === "live" && i.platform === ch.platform && i.channelSlug === ch.slug,
    );
    openItem(existingLive ?? liveItemFromStatus(ch, ch.title || `Canal de ${ch.displayName}`));
  };

  const handleOpenActiveChannel = () => {
    if (!activeWatchItem) return;
    const matchedStatus: LiveChannelStatus = activeLiveStatus ?? {
      id: `${activeWatchItem.platform}:${activeWatchItem.channelSlug}`,
      platform: activeWatchItem.platform,
      slug: activeWatchItem.channelSlug,
      displayName: activeWatchItem.channelName,
      avatarUrl: activeWatchItem.channelAvatar,
      isLive: activeWatchItem.type === "live",
      title: activeWatchItem.title,
      category: activeWatchItem.category,
      viewerCount: activeWatchItem.viewCount,
      startedAt: activeWatchItem.startedAt ?? null,
      thumbnailUrl: activeWatchItem.thumbnailUrl,
      streamId: activeWatchItem.streamId ?? null,
      source: "public",
      checkedAt: 0,
    };
    openChannelPage(matchedStatus);
  };

  const handleResumeProgress = (prog: WatchProgress) => {
    // Match the exact VOD (same key), never "some VOD of the same channel".
    const matching = mergedFeedItems.find((i) => buildProgressKey(i) === prog.key);
    if (matching) return openItem(matching);

    const chStatus = statuses.find(
      (s) => s.platform === prog.platform && s.slug === prog.channelSlug,
    );
    openItem({
      id: prog.key,
      platform: prog.platform,
      channelSlug: prog.channelSlug,
      channelName: prog.channelName,
      channelAvatar:
        chStatus?.avatarUrl || `https://unavatar.io/${prog.platform}/${prog.channelSlug}`,
      type: prog.contentType,
      title: prog.title,
      category: prog.contentType === "vod" ? "VOD" : "Ao vivo",
      thumbnailUrl: prog.thumbnailUrl || "",
      durationSeconds: prog.duration,
      viewCount: 0,
      createdAt: new Date(prog.updatedAt).toISOString(),
      url: prog.url,
      videoId: prog.videoId,
    });
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim()) {
      setSelectedChannel(null);
      if (activeWatchItem && !pipMode) minimizeToPip();
    }
  };

  const activeSelectedChannel = selectedChannel
    ? (statuses.find(
        (s) =>
          s.platform === selectedChannel.platform &&
          s.slug.toLowerCase() === selectedChannel.slug.toLowerCase(),
      ) ?? selectedChannel)
    : null;

  const activeChannelItems = useMemo(() => {
    if (!activeSelectedChannel) return [];
    const key = `${activeSelectedChannel.platform}:${activeSelectedChannel.slug.toLowerCase()}`;
    const fromCache = channelItemsCache[key] ?? [];
    const fromFeed = mergedFeedItems.filter(
      (i) =>
        i.platform === activeSelectedChannel.platform &&
        i.channelSlug.toLowerCase() === activeSelectedChannel.slug.toLowerCase(),
    );
    const seen = new Set<string>();
    const combined: FeedItem[] = [];
    for (const item of [...fromCache, ...fromFeed]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      combined.push(item);
    }
    return combined.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [activeSelectedChannel, channelItemsCache, mergedFeedItems]);

  const selectedChannelKey =
    activeWatchItem && !pipMode
      ? `${activeWatchItem.platform}:${activeWatchItem.channelSlug}`
      : activeSelectedChannel
        ? `${activeSelectedChannel.platform}:${activeSelectedChannel.slug}`
        : activeWatchItem
          ? `${activeWatchItem.platform}:${activeWatchItem.channelSlug}`
          : null;
  const activeLiveStatus = activeWatchItem
    ? statuses.find(
        (s) => s.platform === activeWatchItem.platform && s.slug === activeWatchItem.channelSlug,
      )
    : undefined;
  const activeProgress = activeWatchItem
    ? progressMap[buildProgressKey(activeWatchItem)]
    : undefined;
  const activeLiveCheckpoint =
    activeWatchItem?.type === "live"
      ? findLiveCheckpointForBroadcast(progressMap, {
          platform: activeWatchItem.platform,
          channelSlug: activeWatchItem.channelSlug,
          startedAt: activeLiveStatus?.startedAt || activeWatchItem.startedAt,
          streamId:
            activeLiveStatus?.streamId ||
            activeWatchItem.streamId ||
            (activeWatchItem.platform === "youtube" ? activeWatchItem.videoId : undefined),
        })
      : undefined;

  const liveCount = statuses.filter((st) => st.isLive).length;
  useEffect(() => {
    document.title = liveCount > 0 ? `(${liveCount}) ${BASE_TITLE}` : BASE_TITLE;
  }, [liveCount]);

  // In the player (and multistream) the second header row glides up behind the nav bar while
  // scrolling down (compositor-only transform: zero layout shift, zero scroll bounce).
  // Desktop brings it back on any upward scroll (like X.com); mobile brings it back near the top
  // so it never overlaps the pinned mobile video while reading chat.
  const [stripScrolledAway, setStripHidden] = useState(false);
  const watching = (Boolean(activeWatchItem) && !pipMode) || multiOpen;
  // Outside the player the row is always shown, whatever the last scroll state was.
  const stripHidden = watching && stripScrolledAway;
  useEffect(() => {
    if (!watching) return;
    let lastY = window.scrollY;
    // entering the player starts with the row visible (a new view opens scrolled to the top)
    let frame = window.requestAnimationFrame(() => {
      frame = 0;
      setStripHidden(false);
    });
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const isDesktop = window.innerWidth >= 1024;
        if (y < 24) setStripHidden(false);
        else if (y > lastY + 6 && y > 28) setStripHidden(true);
        else if (isDesktop && y < lastY - 6) setStripHidden(false);
        lastY = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [watching]);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-strip-hidden", stripHidden);
  }, [stripHidden]);

  // Sync triggers: on sign-in, shortly after local edits, every minute, and on returning to the tab.
  const signedIn = Boolean(session.twitch || session.kick);
  /* eslint-disable react-hooks/set-state-in-effect -- start syncing on sign-in, reflect sign-out */
  useEffect(() => {
    signedInRef.current = signedIn;
    if (signedIn && hydrated) syncNow();
    else setSyncInfo({ status: "off", at: null });
  }, [signedIn, hydrated, syncNow]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!signedIn || !hydrated) return;
    const t = window.setTimeout(() => {
      if (syncSignature(buildLocalSyncState()) !== lastSyncSigRef.current) syncNow();
    }, SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [channels, progressMap, bookmarkedIds, signedIn, hydrated, syncNow, buildLocalSyncState]);

  useEffect(() => {
    if (!signedIn) return;
    const tick = window.setInterval(() => {
      if (!document.hidden) syncNow();
    }, SYNC_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) syncNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signedIn, syncNow]);

  const multiCandidates = mergedFeedItems.filter(
    (i) => i.type === "live" && !multiIds.includes(i.id),
  );

  const connectedAvatars = [session.twitch, session.kick].filter(Boolean) as NonNullable<
    AccountSession["twitch"]
  >[];

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-black text-white flex flex-col">
        {/* Translucent sticky chrome — content scrolls underneath */}
        <header
          style={{ viewTransitionName: "chrome", paddingTop: "env(safe-area-inset-top, 0px)" }}
          className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/75 backdrop-blur-2xl backdrop-saturate-150"
        >
          <div className="flex h-14 items-center justify-between gap-2 sm:gap-3 px-3 sm:px-4">
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setSidebarOpen((o) => !o)}
                className="press hidden lg:flex h-9 w-9 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.07] hover:text-white"
                aria-label={sidebarOpen ? "Ocultar barra lateral" : "Mostrar barra lateral"}
                aria-pressed={sidebarOpen}
              >
                <PanelLeft className="h-[18px] w-[18px]" />
              </button>
              <button
                onClick={() => {
                  setSelectedChannel(null);
                  setMultiOpen(false);
                  if (activeWatchItem && !pipMode) minimizeToPip();
                }}
                className="px-1.5"
                aria-label="Streamex — início"
              >
                <StreamexLogo />
              </button>
            </div>

            <div className="hidden md:flex flex-1 max-w-lg mx-4">
              <div className="relative w-full">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/35" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Buscar canais, lives, VODs e clipes"
                  className="w-full rounded-full bg-white/[0.07] pl-10 pr-16 py-2 text-[14px] text-white placeholder:text-white/35 focus:bg-white/[0.1] focus:outline-none focus:ring-1 focus:ring-white/25 transition-colors"
                />
                {searchQuery ? (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/45 hover:text-white"
                    aria-label="Limpar busca"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-white/[0.06] px-1.5 py-0.5 font-sans text-[11px] text-white/40">
                    {shortcutLabel}
                  </kbd>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              {multiItems.length > 0 && (
                <button
                  onClick={() => {
                    activeItemRef.current = null;
                    pipModeRef.current = false;
                    transition(() => {
                      setActiveWatchItem(null);
                      setPipMode(false);
                      setSelectedChannel(null);
                      setMultiOpen(true);
                    });
                  }}
                  aria-pressed={multiOpen}
                  aria-label={`Multistream (${multiItems.length})`}
                  className={cn(
                    "press inline-flex items-center gap-1.5 rounded-full h-9 px-3 text-[13px] font-medium",
                    multiOpen
                      ? "bg-white text-black"
                      : "bg-white/[0.07] text-white hover:bg-white/[0.12]",
                  )}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Multi</span>
                  <span className="tabular text-[12px] opacity-60">{multiItems.length}</span>
                </button>
              )}

              <button
                onClick={toggleNotifications}
                aria-pressed={notifyEnabled}
                className={cn(
                  "press flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/[0.07]",
                  notifyEnabled ? "text-white" : "text-white/60 hover:text-white",
                )}
                aria-label={notifyEnabled ? "Desligar notificações" : "Ligar notificações de live"}
                title={
                  notifyEnabled
                    ? "Notificações ligadas — clique para desligar"
                    : "Avisar quando alguém entrar ao vivo"
                }
              >
                {notifyEnabled ? (
                  <BellRing className="ring-once h-[18px] w-[18px]" />
                ) : (
                  <Bell className="h-[18px] w-[18px]" />
                )}
              </button>

              <button
                onClick={() => setExtensionModalOpen(true)}
                className={cn(
                  // the browser extension only exists on desktop
                  "press relative hidden sm:flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/[0.07]",
                  extensionConnected ? "text-[#53FC18]" : "text-white/60 hover:text-white",
                )}
                aria-label={extensionConnected ? "Extensão conectada" : "Extensão do navegador"}
                title={extensionConnected ? "Extensão conectada" : "Extensão do navegador"}
              >
                <Puzzle className="h-[18px] w-[18px]" />
              </button>

              <button
                onClick={() => refreshFeed(channels, credentials)}
                className="press hidden sm:flex h-9 w-9 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.07] hover:text-white"
                aria-label="Atualizar VODs e clipes"
                title="Atualizar VODs e clipes"
              >
                <RefreshCw className={cn("h-4 w-4", loadingFeed && "animate-spin")} />
              </button>

              <button
                onClick={() => setApiModalOpen(true)}
                aria-label={connectedAvatars.length > 0 ? "Contas conectadas" : "Conectar contas"}
                className="press inline-flex items-center gap-2 rounded-full bg-white/[0.07] hover:bg-white/[0.12] h-9 pl-1.5 pr-1.5 sm:pr-3 text-[13px] font-medium text-white"
              >
                {connectedAvatars.length > 0 ? (
                  <span className="flex -space-x-1.5">
                    {connectedAvatars.map((a) => (
                      <img
                        key={a.platform}
                        src={a.avatarUrl}
                        alt=""
                        className={cn(
                          "h-6 w-6 rounded-full object-cover ring-2 bg-white/10",
                          a.platform === "kick" ? "ring-[#53FC18]" : "ring-[#9146FF]",
                        )}
                      />
                    ))}
                  </span>
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.08]">
                    <UserRound className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="hidden sm:inline">
                  {connectedAvatars.length > 0 ? "Contas" : "Conectar"}
                </span>
              </button>

              <button
                onClick={() => setChannelsModalOpen(true)}
                aria-label={`Canais (${channels.length})`}
                className="press inline-flex items-center gap-1.5 rounded-full bg-white text-black hover:bg-white/90 h-9 px-3.5 text-[13px] font-semibold"
              >
                <Users className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Canais</span>
                <span className="tabular text-[12px] text-black/55">{channels.length}</span>
              </button>
            </div>
          </div>
        </header>

        {/* Second sticky bar: phones keep the live-channel strip (no sidebar); desktop gets the
            smooth rotating ticker. In the player it slides up behind the nav bar on scroll
            (compositor-only transform + opacity, zero layout jump). */}
        <div
          data-strip-bar=""
          aria-hidden={stripHidden || undefined}
          style={{
            viewTransitionName: "ticker",
            top: "calc(var(--chrome-nav-h) + env(safe-area-inset-top, 0px))",
          }}
          className={cn(
            "sticky z-30 border-b border-white/[0.06] bg-black/75 backdrop-blur-2xl backdrop-saturate-150 will-change-transform transition-[transform,opacity] duration-[260ms] ease-[var(--ease-out)]",
            stripHidden
              ? "-translate-y-full opacity-0 pointer-events-none"
              : "translate-y-0 opacity-100",
          )}
        >
          <div className="lg:hidden">
            <TopLiveStrip
              statuses={statuses}
              selectedChannelKey={selectedChannelKey}
              onSelectChannel={handleSelectChannelFromRadar}
              onOpenChannelsModal={() => setChannelsModalOpen(true)}
              latencyMs={latencyMs}
              favoriteIds={favoriteIds}
            />
          </div>
          <div className="hidden lg:block">
            <Ticker
              statuses={statuses}
              favoriteIds={favoriteIds}
              onSelectChannel={handleSelectChannelFromRadar}
              paused={stripHidden}
            />
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          <LiveSidebar
            statuses={statuses}
            selectedChannelKey={selectedChannelKey}
            onSelectChannel={handleSelectChannelFromRadar}
            onOpenChannelsModal={() => setChannelsModalOpen(true)}
            onOpenApiModal={() => setApiModalOpen(true)}
            latencyMs={latencyMs}
            pollTick={pollTick}
            apiHealth={apiHealth}
            sidebarOpen={sidebarOpen}
            twitchConnected={Boolean(session.twitch)}
            favoriteIds={favoriteIds}
            onToggleFavorite={toggleFavorite}
          />

          <main className="flex-1 min-w-0">
            {/* Background view: visible whenever there is no full-screen TheaterView (including while PiP is floating) */}
            {(!activeWatchItem || pipMode) &&
              (multiOpen ? (
                <MultiView
                  items={multiItems}
                  statuses={statuses}
                  candidates={multiCandidates}
                  onAdd={(it) => addToMulti(it, true)}
                  onRemove={(id) => setMultiItems((cur) => cur.filter((m) => m.id !== id))}
                  onBack={() => transition(() => setMultiOpen(false))}
                />
              ) : activeSelectedChannel ? (
                <ChannelView
                  key={`${activeSelectedChannel.platform}:${activeSelectedChannel.slug.toLowerCase()}`}
                  channel={activeSelectedChannel}
                  items={activeChannelItems}
                  loading={
                    loadingChannelKey ===
                    `${activeSelectedChannel.platform}:${activeSelectedChannel.slug.toLowerCase()}`
                  }
                  isFavorite={favoriteIds.has(activeSelectedChannel.id)}
                  progressMap={progressMap}
                  multiIds={multiIds}
                  onBack={() => setSelectedChannel(null)}
                  onRefresh={() => loadChannelVideos(activeSelectedChannel)}
                  onToggleFavorite={toggleFavorite}
                  onWatchLive={(ch) => {
                    const existingLive = mergedFeedItems.find(
                      (i) =>
                        i.type === "live" && i.platform === ch.platform && i.channelSlug === ch.slug,
                    );
                    openItem(
                      existingLive ??
                        liveItemFromStatus(ch, ch.title || `Canal de ${ch.displayName}`),
                    );
                  }}
                  onSelectItem={openItem}
                  onAddToMulti={(it) => addToMulti(it, false)}
                  onToggleWatched={handleToggleWatched}
                />
              ) : (
                <FeedGrid
                  items={mergedFeedItems}
                  statuses={statuses}
                  progressMap={progressMap}
                  bookmarkedIds={bookmarkedIds}
                  activeTab={activeTab}
                  platformFilter={platformFilter}
                  searchQuery={searchQuery}
                  loadingFeed={loadingFeed}
                  apiHealth={apiHealth}
                  twitchConnected={Boolean(session.twitch)}
                  onSearchChange={handleSearchChange}
                  onChangeTab={setActiveTab}
                  onChangePlatform={setPlatformFilter}
                  onSelectItem={openItem}
                  onSelectChannel={handleSelectChannelFromRadar}
                  onResumeProgress={handleResumeProgress}
                  onRemoveProgress={handleRemoveProgress}
                  onMarkProgressWatched={handleMarkProgressWatched}
                  onToggleWatched={handleToggleWatched}
                  onOpenApiModal={() => setApiModalOpen(true)}
                  onOpenChannelsModal={() => setChannelsModalOpen(true)}
                  multiIds={multiIds}
                  onAddToMulti={(it) => addToMulti(it, false)}
                />
              ))}

            {/* Single mounted TheaterView: morphs seamlessly between full theater and floating PiP without reloading the player */}
            {activeWatchItem && (
              <TheaterView
                key={activeWatchItem.id}
                item={activeWatchItem}
                liveStatus={activeLiveStatus}
                relatedItems={mergedFeedItems}
                progress={activeProgress}
                liveCheckpoint={activeLiveCheckpoint}
                isBookmarked={bookmarkedIds.includes(activeWatchItem.id)}
                extensionConnected={extensionConnected}
                isPip={pipMode}
                onBack={minimizeToPip}
                onClose={() => openItem(null)}
                onMinimizeToPip={minimizeToPip}
                onExpandFromPip={expandFromPip}
                onOpenChannel={handleOpenActiveChannel}
                onSelectItem={openItem}
                onSaveProgress={handleSaveProgress}
                onToggleWatched={handleToggleWatched}
                onToggleBookmarkItem={handleToggleBookmark}
                onOpenExtensionModal={() => setExtensionModalOpen(true)}
                inMulti={multiIds.includes(activeWatchItem.id)}
                onAddToMulti={(it) => addToMulti(it, true)}
              />
            )}
          </main>
        </div>

        {/* Toasts — move to top-right while floating PiP is open so they never collide */}
        <div
          className={cn(
            "fixed right-4 left-4 sm:left-auto z-50 flex flex-col gap-2 sm:w-[360px] pointer-events-none",
            activeWatchItem && pipMode
              ? "top-[calc(var(--chrome-h)+0.75rem)]"
              : "bottom-4 pb-[env(safe-area-inset-bottom)]",
          )}
          aria-live="polite"
        >
          <AnimatePresence initial={false}>
            {toasts.map((toast) => (
              <motion.div
                key={toast.id}
                layout="position"
                initial={{ opacity: 0, transform: "translateY(12px) scale(0.97)" }}
                animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
                exit={{
                  opacity: 0,
                  transform: "translateY(12px) scale(0.97)",
                  transition: { duration: 0.16, ease: EASE_OUT },
                }}
                transition={{ type: "spring", bounce: 0, duration: 0.35 }}
                className="pointer-events-auto liquid-glass-panel rounded-2xl p-3 flex items-center gap-3"
              >
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    toast.platform === "kick"
                      ? "bg-[#53FC18]/15 text-[#53FC18]"
                      : toast.platform === "twitch"
                        ? "bg-[#9146FF]/20 text-[#BF94FF]"
                        : toast.platform === "youtube"
                          ? "bg-[#FF0033]/15 text-[#FF4D6A]"
                          : "bg-white/10 text-white",
                  )}
                >
                  <Radio className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-white truncate">{toast.title}</div>
                  <div className="text-[12px] text-white/55 truncate">{toast.subtitle}</div>
                </div>
                {toast.actionItem && (
                  <button
                    onClick={() => {
                      openItem(toast.actionItem!);
                      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                    }}
                    className="press shrink-0 rounded-full bg-white text-black px-3 py-1.5 text-[12px] font-semibold hover:bg-white/90"
                  >
                    Assistir
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <ChannelsModal
          open={channelsModalOpen}
          channels={channels}
          credentials={credentials}
          onClose={() => setChannelsModalOpen(false)}
          onUpdateChannels={handleUpdateChannels}
        />

        <ApiSettingsModal
          open={apiModalOpen}
          session={session}
          credentials={credentials}
          apiHealth={apiHealth}
          syncing={syncing}
          lastSyncAt={lastSyncAt}
          syncMessage={syncMessage}
          onClose={() => setApiModalOpen(false)}
          onSaveCredentials={handleSaveCredentials}
          onSyncTwitch={() => syncTwitchFollows()}
          syncInfo={syncInfo}
          onSyncNow={() => syncNow()}
          onDisconnect={handleDisconnect}
        />

        <ExtensionModal
          open={extensionModalOpen}
          extensionConnected={extensionConnected}
          syncedCount={Object.keys(progressMap).length}
          onClose={() => setExtensionModalOpen(false)}
        />
      </div>
    </MotionConfig>
  );
}

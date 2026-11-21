"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Expand,
  Flag,
  Gauge,
  GripHorizontal,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  Play,
  Puzzle,
  RotateCcw,
  Share2,
  Trash2,
  RectangleHorizontal,
  CircleDot,
  Download,
  LayoutGrid,
  X,
} from "lucide-react";
import type { FeedItem, LiveChannelStatus, WatchBookmark, WatchProgress } from "@/types/streamex";
import {
  BENJI_SPRING,
  buildProgressKey,
  cn,
  formatDuration,
  formatRelativeDate,
  formatUptime,
  formatViewerCount,
  getExternalPlatformUrl,
  PLATFORM_IN,
  streamKeepUrl,
} from "@/lib/utils";
import {
  buildLiveCheckpointKey,
  buildVodProgressFromLive,
  doesCheckpointMatchVod,
  FINISHED_AT,
  isWatchedVod,
  MIN_RESUME_SECONDS,
} from "@/lib/progress";
import { PlatformBadge } from "@/components/StreamexLogo";
import { loadTwitchSdk, type TwitchPlayerInstance } from "@/lib/twitch-sdk";
import { loadYouTubeSdk, YT_STATE, type YTPlayer } from "@/lib/youtube-sdk";
import { loadPlayerPrefs, savePlayerPrefs } from "@/lib/storage";
import { playerSelector, transition } from "@/lib/view-transition";

interface TheaterViewProps {
  item: FeedItem;
  liveStatus?: LiveChannelStatus;
  relatedItems: FeedItem[];
  progress?: WatchProgress;
  liveCheckpoint?: WatchProgress;
  isBookmarked: boolean;
  extensionConnected: boolean;
  isPip?: boolean;
  onBack: () => void;
  onClose?: () => void;
  onMinimizeToPip?: () => void;
  onExpandFromPip?: () => void;
  onOpenChannel?: () => void;
  onSelectItem: (item: FeedItem) => void;
  onSaveProgress: (update: WatchProgress) => void;
  onToggleWatched?: (item: FeedItem) => void;
  onToggleBookmarkItem: (itemId: string) => void;
  onOpenExtensionModal: () => void;
  inMulti: boolean;
  onAddToMulti: (item: FeedItem) => void;
}

type SidebarTab = "chat" | "about" | "moments" | "more";

/** How often a playing VOD writes its position (plus on pause, tab hide and leaving). */
const SAVE_EVERY_MS = 5000;
const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export function TheaterView({
  item,
  liveStatus,
  relatedItems,
  progress,
  liveCheckpoint,
  isBookmarked,
  extensionConnected,
  isPip = false,
  onBack,
  onClose,
  onMinimizeToPip,
  onExpandFromPip,
  onOpenChannel,
  onSelectItem,
  onSaveProgress,
  onToggleWatched,
  onToggleBookmarkItem,
  onOpenExtensionModal,
  inMulti,
  onAddToMulti,
}: TheaterViewProps) {
  const isVod = item.type === "vod";
  const isLive = item.type === "live";
  const liveStartedAt = liveStatus?.startedAt || item.startedAt || null;
  const liveStreamId =
    liveStatus?.streamId ||
    item.streamId ||
    (item.platform === "youtube" ? item.videoId : null) ||
    null;
  const [activeTab, setActiveTab] = useState<SidebarTab>(isLive ? "chat" : "about");
  // Snapshot any prior exit checkpoint once on entering a live so the banner stays readable
  // until dismissed and isn't immediately overwritten by the new session.
  const [previousLiveCheckpoint, setPreviousLiveCheckpoint] = useState<{
    entry: WatchProgress;
    missedMinutes: number;
  } | null>(() => {
    if (!isLive || !liveCheckpoint) return null;
    return {
      entry: liveCheckpoint,
      missedMinutes: Math.max(0, Math.floor((Date.now() - liveCheckpoint.updatedAt) / 60_000)),
    };
  });
  // Only ever rendered client-side (after a click), so reading window here is safe.
  const [hostname] = useState(() =>
    typeof window !== "undefined" ? window.location.hostname || "localhost" : "localhost",
  );
  const [copiedShare, setCopiedShare] = useState(false);
  const [bookmarkLabel, setBookmarkLabel] = useState("");
  const [currentTime, setCurrentTime] = useState<number>(progress?.currentTime ?? 0);
  const [duration, setDuration] = useState<number>(progress?.duration || item.durationSeconds || 0);
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  const [playerError, setPlayerError] = useState(false);
  const [cinema, setCinema] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem("streamex:cinema:v1") === "1";
    } catch {
      return false;
    }
  });
  const [pipCorner, setPipCorner] = useState<"br" | "bl" | "tr" | "tl">("br");
  const [pipLarge, setPipLarge] = useState(false);
  const [draggingPip, setDraggingPip] = useState(false);
  const pipCardRef = useRef<HTMLDivElement | null>(null);
  const isMarkedWatched = isVod && isWatchedVod(progress);
  const prevMarkedWatchedRef = useRef(isMarkedWatched);
  const markedWatchedInSessionRef = useRef(false);
  useEffect(() => {
    // Only lock out automatic progress saves if the user marked this VOD as watched *during* this session
    // (either from the player button or from the feed card while in PiP). Re-opening an old watched VOD
    // should still save new progress once the user watches >= 15s.
    if (!prevMarkedWatchedRef.current && isMarkedWatched) {
      markedWatchedInSessionRef.current = true;
    } else if (!isMarkedWatched) {
      markedWatchedInSessionRef.current = false;
    }
    prevMarkedWatchedRef.current = isMarkedWatched;
  }, [isMarkedWatched]);

  // Magnetic 4-corner drag & snap for the floating PiP mini-player (iOS/macOS-style FLIP glide).
  // Dragging anywhere on the bottom bar (except action buttons) moves the PiP; a tap on the
  // channel info expands it back to full theater mode.
  const handlePipDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPip || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a")) return;
    const card = pipCardRef.current;
    if (!card) return;

    const tapExpand = Boolean((e.target as HTMLElement).closest("[data-pip-expand]"));
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let dx = 0;
    let dy = 0;

    const onMove = (ev: PointerEvent) => {
      dx = ev.clientX - startX;
      dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      if (!moved) {
        moved = true;
        setDraggingPip(true);
        card.style.transition = "none";
      }
      card.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!moved) {
        if (tapExpand) onExpandFromPip?.();
        return;
      }
      setDraggingPip(false);

      const fromRect = card.getBoundingClientRect();
      const cx = fromRect.left + fromRect.width / 2;
      const cy = fromRect.top + fromRect.height / 2;
      const horiz = cx < window.innerWidth / 2 ? "l" : "r";
      const vert = cy < window.innerHeight / 2 ? "t" : "b";
      const nextCorner = `${vert}${horiz}` as "br" | "bl" | "tr" | "tl";

      card.style.transform = "";
      card.style.transition = "";
      setPipCorner(nextCorner);

      window.requestAnimationFrame(() => {
        const toRect = card.getBoundingClientRect();
        const invX = fromRect.left - toRect.left;
        const invY = fromRect.top - toRect.top;
        if (Math.abs(invX) < 1 && Math.abs(invY) < 1) return;
        card.style.transition = "none";
        card.style.transform = `translate3d(${invX}px, ${invY}px, 0)`;
        card.getBoundingClientRect(); // commit inverted start frame
        card.style.transition = "transform 340ms cubic-bezier(0.22, 1, 0.36, 1)";
        card.style.transform = "translate3d(0, 0, 0)";
        window.setTimeout(() => {
          if (card) {
            card.style.transition = "";
            card.style.transform = "";
          }
        }, 360);
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  // The player box morphs between sizes (View Transition), the rest crossfades.
  const toggleCinema = () =>
    transition(
      () => {
        setCinema((c) => {
          try {
            localStorage.setItem("streamex:cinema:v1", c ? "0" : "1");
          } catch {
            // ignore
          }
          return !c;
        });
      },
      {
        from: () => document.querySelector(playerSelector),
        to: () => document.querySelector(playerSelector),
      },
    );

  const twitchContainerRef = useRef<HTMLDivElement | null>(null);
  const twitchPlayerRef = useRef<TwitchPlayerInstance | null>(null);
  const ytMountRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const hlsVideoRef = useRef<HTMLVideoElement | null>(null);
  const progressKey = useMemo(() => buildProgressKey(item), [item]);
  const prefsVodKey = isVod ? progressKey : undefined;
  const [playbackRate, setPlaybackRate] = useState<number>(() =>
    isVod ? loadPlayerPrefs(buildProgressKey(item)).playbackRate : 1,
  );
  const desiredRateRef = useRef(playbackRate);

  // Read the saved position once per item (the view is keyed by item id); later saves
  // must not re-trigger the player effects.
  const [resumeTarget] = useState(() => {
    if (item.type !== "vod" || !progress || progress.watched || progress.currentTime < MIN_RESUME_SECONDS)
      return 0;
    if (progress.duration > 0 && progress.currentTime / progress.duration >= FINISHED_AT) return 0;
    return Math.floor(progress.currentTime);
  });
  const latestProgressRef = useRef(progress);
  useEffect(() => {
    latestProgressRef.current = progress;
  }, [progress]);
  const lastSavedRef = useRef<number>(-1);

  /**
   * While resuming, players report positions near 0 (Twitch plays its preroll first, HLS fires
   * timeupdate before the seek lands). Saving those would overwrite the real position, so saves
   * stay disarmed until playback reaches the resume point, the user seeks via our controls, or
   * ~45s of playback pass (the user chose to watch from somewhere else).
   */
  const saveArmedRef = useRef(resumeTarget === 0);
  const playedSecondsRef = useRef(0);
  const canSave = (t: number) => {
    if (saveArmedRef.current) return true;
    if (t >= resumeTarget - 5 || playedSecondsRef.current >= 45) {
      saveArmedRef.current = true;
      return true;
    }
    return false;
  };

  // Kick VODs opened from "Continuar" may not carry their HLS source; look it up.
  const [hlsUrl, setHlsUrl] = useState<string | undefined>(item.hlsUrl);
  const [resolvingSource, setResolvingSource] = useState(
    item.platform === "kick" && isVod && !item.hlsUrl && Boolean(item.videoId),
  );
  useEffect(() => {
    if (!resolvingSource || !item.videoId) return;
    let alive = true;
    fetch(`/api/kick-video?id=${encodeURIComponent(item.videoId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { hlsUrl?: string; durationSeconds?: number } | null) => {
        if (!alive) return;
        if (d?.hlsUrl) setHlsUrl(d.hlsUrl);
        if (d?.durationSeconds) setDuration((cur) => cur || d.durationSeconds!);
      })
      .catch(() => undefined)
      .finally(() => alive && setResolvingSource(false));
    return () => {
      alive = false;
    };
  }, [resolvingSource, item.videoId]);

  const twitchNeedsVideoId = item.platform === "twitch" && isVod && !item.videoId;
  // YouTube is played by video id; an offline channel opened from the sidebar has none.
  const youtubeOffline = item.platform === "youtube" && !item.videoId;
  const useKickHls = item.platform === "kick" && item.type !== "live" && Boolean(hlsUrl);
  const kickVodWithoutSource = item.platform === "kick" && isVod && !hlsUrl && !resolvingSource;

  /** Persist the VOD position. Lives and clips are never written — there is nothing to resume. */
  const persist = useCallback(
    (timeSec: number, durSec: number, bookmarksOverride?: WatchBookmark[], force = false) => {
      if (!isVod && !bookmarksOverride) return;
      // If the user explicitly marked this VOD as watched during this session, don't unmark it on pause/unmount.
      if (markedWatchedInSessionRef.current && !bookmarksOverride) return;
      // If re-opening an older watched VOD, wait until they've actually watched >= 15s (or seeked) before unmarking it.
      if (prevMarkedWatchedRef.current && !bookmarksOverride && playedSecondsRef.current < 15 && !force)
        return;
      const cleanTime = Math.max(0, Math.floor(timeSec));
      if (!force && !bookmarksOverride && Math.abs(cleanTime - lastSavedRef.current) < 2) return;
      lastSavedRef.current = cleanTime;
      onSaveProgress({
        key: progressKey,
        platform: item.platform,
        channelSlug: item.channelSlug,
        channelName: item.channelName,
        contentType: item.type,
        videoId: item.videoId,
        title: item.title,
        thumbnailUrl: item.thumbnailUrl,
        currentTime: cleanTime,
        duration: Math.max(0, Math.floor(durSec || item.durationSeconds || 0)),
        updatedAt: Date.now(),
        url: getExternalPlatformUrl(item, cleanTime),
        source: "streamex",
        bookmarks: bookmarksOverride ?? latestProgressRef.current?.bookmarks ?? [],
        watched: markedWatchedInSessionRef.current ? true : undefined,
      });
    },
    [isVod, item, onSaveProgress, progressKey],
  );
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  // 0) Live exit checkpoint: while watching a live stream, periodically record the broadcast offset
  // (and flush immediately when leaving/hiding) so returning shows where you left off AND the VOD
  // automatically resumes at that exact minute once the live ends.
  const liveMetaRef = useRef({
    startedAt: liveStartedAt,
    streamId: liveStreamId,
    title: liveStatus?.title || item.title,
    thumbnailUrl: liveStatus?.thumbnailUrl || item.thumbnailUrl,
    checkpointKey: liveCheckpoint?.key,
    bookmarks: liveCheckpoint?.bookmarks ?? [],
  });
  useEffect(() => {
    liveMetaRef.current = {
      startedAt: liveStartedAt,
      streamId: liveStreamId,
      title: liveStatus?.title || item.title,
      thumbnailUrl: liveStatus?.thumbnailUrl || item.thumbnailUrl,
      checkpointKey: liveCheckpoint?.key ?? liveMetaRef.current.checkpointKey,
      bookmarks: liveCheckpoint?.bookmarks ?? liveMetaRef.current.bookmarks,
    };
  }, [liveStartedAt, liveStreamId, liveStatus, item.title, item.thumbnailUrl, liveCheckpoint]);

  useEffect(() => {
    if (!isLive) return;
    let watchedSec = 0;
    let lastFlushAt = 0;

    const computeOffset = (): number | null => {
      if (item.platform === "youtube") {
        try {
          const ytTime = ytPlayerRef.current?.getCurrentTime?.() ?? 0;
          if (Number.isFinite(ytTime) && ytTime >= MIN_RESUME_SECONDS) {
            return Math.floor(ytTime);
          }
        } catch {
          // player not ready
        }
      }
      const startIso = liveMetaRef.current.startedAt;
      if (!startIso) return null;
      const startMs = Date.parse(startIso);
      if (Number.isNaN(startMs)) return null;
      return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    };

    const flushLive = (force = false) => {
      // Wait until the user actually watched >= 10s so accidental clicks don't overwrite an older exit point.
      if (watchedSec < 10) return;
      if (!force && Date.now() - lastFlushAt < 14_000) return;
      const offset = computeOffset();
      if (offset === null || offset < MIN_RESUME_SECONDS) return;
      const meta = liveMetaRef.current;
      const key =
        meta.checkpointKey ||
        buildLiveCheckpointKey({
          platform: item.platform,
          channelSlug: item.channelSlug,
          startedAt: meta.startedAt,
          streamId: meta.streamId,
        });
      meta.checkpointKey = key;
      lastFlushAt = Date.now();
      onSaveProgress({
        key,
        platform: item.platform,
        channelSlug: item.channelSlug,
        channelName: item.channelName,
        contentType: "live",
        videoId: item.videoId,
        title: meta.title,
        thumbnailUrl: meta.thumbnailUrl,
        currentTime: offset,
        duration: 0,
        updatedAt: Date.now(),
        url: item.url,
        source: "streamex",
        bookmarks: meta.bookmarks,
        streamStartedAt: meta.startedAt ?? undefined,
        streamId: meta.streamId ?? undefined,
      });
    };

    const tick = window.setInterval(() => {
      if (!document.hidden) {
        watchedSec += 1;
        if (watchedSec >= 10) flushLive(false);
      }
    }, 1000);

    const onHide = () => {
      if (document.hidden) flushLive(true);
    };
    const onPageHide = () => flushLive(true);

    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      flushLive(true);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, isLive]);

  // 1) Twitch embed (live + VOD). Clips use the clip iframe.
  useEffect(() => {
    if (item.platform !== "twitch" || item.type === "clip" || twitchNeedsVideoId) return;
    const container = twitchContainerRef.current;
    if (!container) return;

    let destroyed = false;
    let tick: number | null = null;
    let lastPersistAt = 0;

    const savedPrefs = loadPlayerPrefs(prefsVodKey);
    let prefsApplied = false;
    let appliedOnPlay = false;
    let lastSavedVol = savedPrefs.volume;
    let lastSavedMuted = savedPrefs.muted;

    const read = () => {
      const p = twitchPlayerRef.current;
      if (!p) return null;
      try {
        const t = p.getCurrentTime?.() ?? 0;
        const d = p.getDuration?.() ?? 0;
        return { t: Number.isFinite(t) ? t : 0, d: Number.isFinite(d) ? d : 0 };
      } catch {
        return null;
      }
    };

    const capturePrefs = () => {
      const p = twitchPlayerRef.current;
      if (!p || !prefsApplied) return;
      try {
        const vol = p.getVolume?.();
        const muted = p.getMuted?.();
        if (typeof vol === "number" && Number.isFinite(vol)) {
          const rounded = Math.round(vol * 100) / 100;
          const nextMuted = typeof muted === "boolean" ? muted : lastSavedMuted;
          if (Math.abs(rounded - lastSavedVol) >= 0.01 || nextMuted !== lastSavedMuted) {
            lastSavedVol = rounded;
            lastSavedMuted = nextMuted;
            savePlayerPrefs({ volume: rounded, muted: nextMuted }, prefsVodKey);
          }
        }
      } catch {
        // ignore
      }
    };

    const flush = () => {
      capturePrefs();
      const r = read();
      if (r && r.t > MIN_RESUME_SECONDS && canSave(r.t))
        persistRef.current(r.t, r.d || item.durationSeconds, undefined, true);
    };
    let lastT = 0;

    loadTwitchSdk()
      .then(() => {
        if (destroyed || !window.Twitch?.Player) return;
        container.innerHTML = "";
        const options: Record<string, unknown> = {
          width: "100%",
          height: "100%",
          parent: Array.from(new Set([window.location.hostname || "localhost", "localhost"])),
          autoplay: true,
          muted: savedPrefs.muted,
        };
        if (isVod && item.videoId) {
          options.video = item.videoId.startsWith("v") ? item.videoId : `v${item.videoId}`;
          if (resumeTarget > 0) {
            const h = Math.floor(resumeTarget / 3600);
            const m = Math.floor((resumeTarget % 3600) / 60);
            const s = resumeTarget % 60;
            options.time = `${h}h${m}m${s}s`;
            setResumedFrom(resumeTarget);
          }
        } else {
          options.channel = item.channelSlug;
        }

        const player = new window.Twitch.Player(container, options);
        twitchPlayerRef.current = player;

        const applyPrefs = () => {
          try {
            player.setVolume?.(lastSavedVol);
            player.setMuted?.(lastSavedMuted);
            prefsApplied = true;
          } catch {
            // not ready yet
          }
        };

        player.addEventListener(window.Twitch.Player.READY, applyPrefs);
        player.addEventListener(window.Twitch.Player.PLAYING, () => {
          if (!appliedOnPlay) {
            appliedOnPlay = true;
            applyPrefs();
          }
        });
        player.addEventListener(window.Twitch.Player.PAUSE, flush);
        player.addEventListener(window.Twitch.Player.ENDED, flush);

        tick = window.setInterval(() => {
          capturePrefs();
          const r = read();
          if (!r || r.t <= 1) return;
          if (r.t > lastT && r.t - lastT < 3) playedSecondsRef.current += r.t - lastT;
          lastT = r.t;
          setCurrentTime(r.t);
          if (r.d > 0) setDuration(r.d);
          if (
            isVod &&
            canSave(r.t) &&
            Date.now() - lastPersistAt > SAVE_EVERY_MS &&
            !player.isPaused?.()
          ) {
            lastPersistAt = Date.now();
            persistRef.current(r.t, r.d || item.durationSeconds);
          }
        }, 1000);
      })
      .catch(() => setPlayerError(true));

    const onHide = () => document.hidden && flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);

    return () => {
      destroyed = true;
      flush();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      if (tick) window.clearInterval(tick);
      twitchPlayerRef.current = null;
      container.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // 1b) YouTube (live + uploads) through the IFrame Player API, for progress + seeking + prefs
  useEffect(() => {
    if (item.platform !== "youtube" || !item.videoId) return;
    const mount = ytMountRef.current;
    if (!mount) return;
    let destroyed = false;
    let tick: number | null = null;
    let lastPersistAt = 0;
    let lastT = 0;

    const savedPrefs = loadPlayerPrefs(prefsVodKey);
    let prefsApplied = false;
    let reappliedRateOnPlay = false;
    let lastSavedVol = savedPrefs.volume;
    let lastSavedMuted = savedPrefs.muted;
    let lastSavedRate = savedPrefs.playbackRate;

    const read = () => {
      const p = ytPlayerRef.current;
      if (!p) return null;
      try {
        return { t: p.getCurrentTime() || 0, d: p.getDuration() || 0 };
      } catch {
        return null;
      }
    };

    const capturePrefs = () => {
      const p = ytPlayerRef.current;
      if (!p || !prefsApplied) return;
      try {
        const volRaw = p.getVolume?.();
        const muted = p.isMuted?.();
        const rate = isVod ? p.getPlaybackRate?.() : undefined;
        const patch: { volume?: number; muted?: boolean; playbackRate?: number } = {};

        if (typeof volRaw === "number" && Number.isFinite(volRaw)) {
          const vol = Math.round(volRaw) / 100;
          if (Math.abs(vol - lastSavedVol) >= 0.01) {
            lastSavedVol = vol;
            patch.volume = vol;
          }
        }
        if (typeof muted === "boolean" && muted !== lastSavedMuted) {
          lastSavedMuted = muted;
          patch.muted = muted;
        }
        if (
          isVod &&
          typeof rate === "number" &&
          Number.isFinite(rate) &&
          rate > 0 &&
          Math.abs(rate - lastSavedRate) >= 0.01
        ) {
          lastSavedRate = rate;
          patch.playbackRate = rate;
          setPlaybackRate(rate);
        }
        if (Object.keys(patch).length > 0) savePlayerPrefs(patch, prefsVodKey);
      } catch {
        // ignore
      }
    };

    const flush = () => {
      capturePrefs();
      const r = read();
      if (r && r.t > MIN_RESUME_SECONDS && canSave(r.t))
        persistRef.current(r.t, r.d || item.durationSeconds, undefined, true);
    };

    loadYouTubeSdk()
      .then(() => {
        if (destroyed || !window.YT?.Player) return;
        const target = document.createElement("div");
        mount.appendChild(target);
        ytPlayerRef.current = new window.YT.Player(target, {
          videoId: item.videoId!,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 1,
            playsinline: 1,
            rel: 0,
            ...(isVod && resumeTarget > 0 ? { start: resumeTarget } : {}),
          },
          events: {
            onReady: () => {
              if (isVod && resumeTarget > 0) setResumedFrom(resumeTarget);
              const p = ytPlayerRef.current;
              if (!p) return;
              try {
                p.setVolume?.(Math.round(lastSavedVol * 100));
                if (lastSavedMuted) p.mute?.();
                else p.unMute?.();
                if (isVod && lastSavedRate !== 1) {
                  p.setPlaybackRate?.(lastSavedRate);
                }
                prefsApplied = true;
              } catch {
                // ignore
              }
            },
            onStateChange: (e) => {
              if (e.data === YT_STATE.PLAYING && !reappliedRateOnPlay) {
                reappliedRateOnPlay = true;
                try {
                  if (isVod && desiredRateRef.current !== 1) {
                    lastSavedRate = desiredRateRef.current;
                    ytPlayerRef.current?.setPlaybackRate?.(desiredRateRef.current);
                  }
                } catch {
                  // ignore
                }
              }
              if (e.data === YT_STATE.PAUSED || e.data === YT_STATE.ENDED) flush();
            },
            onPlaybackRateChange: (e) => {
              if (!prefsApplied || !isVod) return;
              if (
                typeof e.data === "number" &&
                e.data > 0 &&
                Math.abs(e.data - lastSavedRate) >= 0.01
              ) {
                lastSavedRate = e.data;
                desiredRateRef.current = e.data;
                setPlaybackRate(e.data);
                savePlayerPrefs({ playbackRate: e.data }, prefsVodKey);
              }
            },
            onError: () => setPlayerError(true),
          },
        });
        tick = window.setInterval(() => {
          capturePrefs();
          const r = read();
          if (!r || r.t <= 1) return;
          if (r.t > lastT && r.t - lastT < 3) playedSecondsRef.current += r.t - lastT;
          lastT = r.t;
          setCurrentTime(r.t);
          if (r.d > 0) setDuration(r.d);
          const playing = ytPlayerRef.current?.getPlayerState() === YT_STATE.PLAYING;
          if (isVod && playing && canSave(r.t) && Date.now() - lastPersistAt > SAVE_EVERY_MS) {
            lastPersistAt = Date.now();
            persistRef.current(r.t, r.d || item.durationSeconds);
          }
        }, 1000);
      })
      .catch(() => setPlayerError(true));

    const onHide = () => document.hidden && flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      destroyed = true;
      flush();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      if (tick) window.clearInterval(tick);
      try {
        ytPlayerRef.current?.destroy();
      } catch {
        // already gone
      }
      ytPlayerRef.current = null;
      mount.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // 2) Kick VOD/clip via HLS (exact resume + position tracking + persisted speed/volume)
  useEffect(() => {
    if (!useKickHls || !hlsUrl) return;
    const video = hlsVideoRef.current;
    if (!video) return;

    let hls: { destroy: () => void } | null = null;
    let disposed = false;
    let lastPersistAt = 0;

    const savedPrefs = loadPlayerPrefs(prefsVodKey);
    let prefsApplied = false;
    let reappliedOnPlay = false;

    const applyPrefs = () => {
      video.volume = savedPrefs.volume;
      video.muted = savedPrefs.muted;
      if (isVod) {
        const targetRate = desiredRateRef.current;
        video.defaultPlaybackRate = targetRate;
        video.playbackRate = targetRate;
      }
    };

    // Apply before loading so browser defaults never flash or overwrite stored preferences.
    applyPrefs();

    const onLoaded = () => {
      applyPrefs();
      prefsApplied = true;
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
      if (resumeTarget > 0 && (!video.duration || resumeTarget < video.duration - 5)) {
        video.currentTime = resumeTarget;
        setResumedFrom(resumeTarget);
      }
    };

    const onPlaying = () => {
      if (!reappliedOnPlay) {
        reappliedOnPlay = true;
        // Some browsers reset playbackRate on first play after HLS attach; enforce stored rate once.
        const targetRate = desiredRateRef.current;
        if (isVod && Math.abs(video.playbackRate - targetRate) >= 0.01) {
          video.defaultPlaybackRate = targetRate;
          video.playbackRate = targetRate;
        }
        prefsApplied = true;
      }
    };

    const onVolumeChange = () => {
      if (!prefsApplied) return;
      savedPrefs.volume = Math.round(video.volume * 100) / 100;
      savedPrefs.muted = video.muted;
      savePlayerPrefs({ volume: savedPrefs.volume, muted: savedPrefs.muted }, prefsVodKey);
    };

    const onRateChange = () => {
      if (!prefsApplied || !isVod) return;
      const r = Math.round(video.playbackRate * 100) / 100;
      if (r > 0 && Math.abs(r - desiredRateRef.current) >= 0.01) {
        savedPrefs.playbackRate = r;
        desiredRateRef.current = r;
        video.defaultPlaybackRate = r;
        setPlaybackRate(r);
        savePlayerPrefs({ playbackRate: r }, prefsVodKey);
      }
    };

    // Phones (iOS Safari, Android Chrome) play HLS natively: faster start, no extra download.
    // Desktop Chrome/Edge/Firefox need hls.js, loaded on demand (prefetched while idle).
    const native =
      !hlsUrl.includes(".m3u8") || Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
    if (native) {
      video.src = hlsUrl;
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          video.src = hlsUrl;
          return;
        }
        const h = new Hls({
          enableWorker: true,
          startPosition: resumeTarget > 0 ? resumeTarget : -1,
        });
        h.loadSource(hlsUrl);
        h.attachMedia(video);
        h.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setPlayerError(true);
        });
        hls = h;
      });
    }
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("playing", onPlaying);
    video.addEventListener("volumechange", onVolumeChange);
    video.addEventListener("ratechange", onRateChange);

    const flush = () => {
      if (prefsApplied) {
        savePlayerPrefs(
          {
            volume: Math.round(video.volume * 100) / 100,
            muted: video.muted,
            ...(isVod && video.playbackRate > 0 ? { playbackRate: video.playbackRate } : {}),
          },
          prefsVodKey,
        );
      }
      if (video.currentTime > MIN_RESUME_SECONDS && canSave(video.currentTime))
        persistRef.current(video.currentTime, video.duration, undefined, true);
    };
    let lastT = 0;
    const onTime = () => {
      const t = video.currentTime;
      if (t > lastT && t - lastT < 3) playedSecondsRef.current += t - lastT;
      lastT = t;
      setCurrentTime(t);
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
      if (!video.paused && canSave(t) && Date.now() - lastPersistAt > SAVE_EVERY_MS) {
        lastPersistAt = Date.now();
        persistRef.current(video.currentTime, video.duration);
      }
    };
    const onHide = () => document.hidden && flush();

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("pause", flush);
    video.addEventListener("ended", flush);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);

    return () => {
      flush();
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("ratechange", onRateChange);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("pause", flush);
      video.removeEventListener("ended", flush);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      disposed = true;
      hls?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, useKickHls, hlsUrl]);

  const supportsSpeedControl = isVod && (useKickHls || item.platform === "youtube");
  const handleCycleSpeed = () => {
    const idx = SPEED_STEPS.findIndex((s) => Math.abs(s - playbackRate) < 0.05);
    const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
    desiredRateRef.current = next;
    setPlaybackRate(next);
    savePlayerPrefs({ playbackRate: next }, prefsVodKey);
    if (hlsVideoRef.current) {
      hlsVideoRef.current.defaultPlaybackRate = next;
      hlsVideoRef.current.playbackRate = next;
    }
    try {
      ytPlayerRef.current?.setPlaybackRate?.(next);
    } catch {
      // player not ready
    }
  };

  const handleSeekTo = (seconds: number) => {
    const clean = Math.max(0, Math.floor(seconds));
    saveArmedRef.current = true; // the user picked this position on purpose
    markedWatchedInSessionRef.current = false;
    setCurrentTime(clean);
    try {
      twitchPlayerRef.current?.seek(clean);
    } catch {
      // live streams can't seek
    }
    if (hlsVideoRef.current) hlsVideoRef.current.currentTime = clean;
    try {
      ytPlayerRef.current?.seekTo(clean, true);
    } catch {
      // player not ready yet
    }
    persist(clean, duration, undefined, true);
  };

  const handleAddBookmark = () => {
    const label = bookmarkLabel.trim() || `Momento em ${formatDuration(currentTime)}`;
    const next: WatchBookmark[] = [
      { id: `${Date.now()}`, time: Math.floor(currentTime), label, createdAt: Date.now() },
      ...(progress?.bookmarks ?? []),
    ];
    persist(currentTime, duration, next);
    setBookmarkLabel("");
  };

  const handleDeleteBookmark = (id: string) => {
    persist(
      currentTime,
      duration,
      (progress?.bookmarks ?? []).filter((b) => b.id !== id),
    );
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(getExternalPlatformUrl(item, isVod ? currentTime : 0));
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  const externalUrl = getExternalPlatformUrl(item, isVod ? currentTime : 0);
  const progressFraction = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  const others = relatedItems.filter((r) => r.id !== item.id);
  const sameChannel = others.filter(
    (r) => r.platform === item.platform && r.channelSlug === item.channelSlug,
  );
  const moreItems = [...sameChannel, ...others.filter((r) => !sameChannel.includes(r))].slice(
    0,
    16,
  );

  const currentIdx = relatedItems.findIndex((r) => r.id === item.id);
  const prevItem =
    relatedItems.length > 1
      ? relatedItems[(currentIdx - 1 + relatedItems.length) % relatedItems.length]
      : null;
  const nextItem =
    relatedItems.length > 1 ? relatedItems[(currentIdx + 1) % relatedItems.length] : null;

  const tabs = [
    { id: "chat", label: "Chat", show: item.type === "live" || item.platform === "twitch" },
    { id: "about", label: "Sobre", show: true },
    { id: "moments", label: "Momentos", show: isVod },
    { id: "more", label: "Mais", show: true },
  ].filter((t) => t.show) as Array<{ id: SidebarTab; label: string }>;

  const matchingLiveVod = useMemo(() => {
    if (!previousLiveCheckpoint) return null;
    return relatedItems.find((r) => doesCheckpointMatchVod(previousLiveCheckpoint.entry, r)) ?? null;
  }, [previousLiveCheckpoint, relatedItems]);

  const liveArchivesUrl =
    item.platform === "kick"
      ? `https://kick.com/${encodeURIComponent(item.channelSlug)}/videos`
      : item.platform === "youtube"
        ? `https://www.youtube.com/channel/${encodeURIComponent(item.channelSlug)}/streams`
        : `https://www.twitch.tv/${encodeURIComponent(item.channelSlug)}/videos?filter=archives`;

  const pipCornerClass =
    pipCorner === "bl"
      ? "bottom-4 left-4"
      : pipCorner === "tr"
        ? "top-[calc(var(--chrome-h)+0.75rem)] right-4"
        : pipCorner === "tl"
          ? "top-[calc(var(--chrome-h)+0.75rem)] left-4"
          : "bottom-4 right-4";

  return (
    <div
      ref={pipCardRef}
      className={cn(
        isPip
          ? cn(
              "fixed z-50 rounded-[20px] bg-[#0c0c0e]/92 backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-white/[0.14] shadow-[0_28px_72px_-16px_rgba(0,0,0,0.92),inset_0_1px_0_rgba(255,255,255,0.12)] overflow-hidden transition-[width] duration-[240ms] ease-[var(--ease-drawer)] will-change-transform",
              pipCornerClass,
              pipLarge
                ? "w-[460px] max-w-[calc(100vw-2rem)]"
                : "w-[300px] sm:w-[360px] max-w-[calc(100vw-2rem)]",
            )
          : "w-full px-3 sm:px-5 pt-3 pb-8",
      )}
    >
      {!isPip && (
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={onMinimizeToPip ?? onBack}
              className="press inline-flex items-center gap-1.5 rounded-full pl-2 pr-3.5 py-1.5 text-[14px] font-medium text-white/75 hover:bg-white/[0.07] hover:text-white"
              title="Voltar ao feed mantendo o vídeo tocando no mini player (P)"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </button>

            {onMinimizeToPip && (
              <button
                onClick={onMinimizeToPip}
                className="press inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] px-3 py-1.5 text-[13px] font-medium text-white/80 hover:text-white"
                title="Abrir no mini player flutuante (P)"
              >
                <PictureInPicture2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Mini player</span>
              </button>
            )}

            {onClose && (
              <button
                onClick={onClose}
                className="press flex h-8 w-8 items-center justify-center rounded-full text-white/45 hover:bg-white/[0.07] hover:text-white"
                aria-label="Fechar player"
                title="Fechar player e parar reprodução"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {resumedFrom !== null && (
            <div className="enter flex items-center gap-2 rounded-full bg-[#53FC18]/10 ring-1 ring-inset ring-[#53FC18]/20 pl-3 pr-1 py-1 text-[13px] text-[#53FC18]">
              <span className="tabular">
                Continuando de {formatDuration(resumedFrom)}
                {progress?.fromLive ? " · da live" : ""}
              </span>
              <button
                onClick={() => {
                  handleSeekTo(0);
                  setResumedFrom(null);
                }}
                className="press rounded-full bg-white/10 hover:bg-white/20 px-2.5 py-0.5 text-[12px] font-medium text-white"
              >
                Do início
              </button>
            </div>
          )}

          {isLive && previousLiveCheckpoint && (
            <div className="enter flex flex-wrap items-center gap-1.5 rounded-full bg-white/[0.07] ring-1 ring-inset ring-white/[0.1] pl-3 pr-1.5 py-1 text-[12px] sm:text-[13px] text-white/90">
              <Clock className="h-3.5 w-3.5 shrink-0 text-[#53FC18]" />
              <span className="tabular">
                Você saiu em{" "}
                <strong className="font-semibold text-white">
                  {formatDuration(previousLiveCheckpoint.entry.currentTime)}
                </strong>
                {previousLiveCheckpoint.missedMinutes >= 1 && (
                  <span className="text-white/50">
                    {" "}
                    · há {previousLiveCheckpoint.missedMinutes}m
                  </span>
                )}
              </span>
              {item.platform === "youtube" ? (
                <button
                  onClick={() => {
                    handleSeekTo(previousLiveCheckpoint.entry.currentTime);
                    setPreviousLiveCheckpoint(null);
                  }}
                  className="press rounded-full bg-[#53FC18] px-2.5 py-0.5 text-[12px] font-semibold text-black hover:brightness-110"
                >
                  Ir para {formatDuration(previousLiveCheckpoint.entry.currentTime)}
                </button>
              ) : matchingLiveVod ? (
                <button
                  onClick={() => {
                    const vodProg = buildVodProgressFromLive(
                      previousLiveCheckpoint.entry,
                      matchingLiveVod,
                    );
                    onSaveProgress(vodProg);
                    onSelectItem(matchingLiveVod);
                  }}
                  className="press rounded-full bg-white px-2.5 py-0.5 text-[12px] font-semibold text-black hover:bg-white/90"
                >
                  Ver VOD de {formatDuration(previousLiveCheckpoint.entry.currentTime)}
                </button>
              ) : (
                <a
                  href={liveArchivesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="press inline-flex items-center gap-1 rounded-full bg-white/10 hover:bg-white/20 px-2.5 py-0.5 text-[12px] font-medium text-white"
                  title="Quando a live virar VOD, o Streamex continua automaticamente desse minuto"
                >
                  VODs
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
              <button
                onClick={() => setPreviousLiveCheckpoint(null)}
                className="press flex h-6 w-6 items-center justify-center rounded-full text-white/45 hover:bg-white/10 hover:text-white"
                aria-label="Fechar aviso"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Keep the exact same tree depth for the video column across full ↔ PiP so React NEVER
          unmounts the <video>/<iframe> and audio/playback never hiccup. */}
      <div
        key="theater-layout"
        className={
          isPip
            ? "block"
            : cn(
                "grid grid-cols-1 gap-4 items-start",
                !cinema && "xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]",
              )
        }
      >
        <div
          key="theater-video-col"
          className={
            isPip
              ? "min-w-0"
              : cn("min-w-0 space-y-4 max-sm:contents", cinema && "-mx-3 sm:-mx-5")
          }
        >
          <div
            key="theater-video-sticky"
            className={
              isPip
                ? "relative group/pip"
                : cn(
                    "max-sm:sticky max-sm:top-[calc(var(--chrome-nav-h)+env(safe-area-inset-top,0px))] max-sm:z-20 max-sm:-mx-3 max-sm:bg-black",
                    cinema && "bg-black py-2",
                  )
            }
          >
            <div
              data-vt="player"
              style={
                isPip
                  ? undefined
                  : {
                      maxWidth: cinema
                        ? "calc((100dvh - var(--player-chrome-h) - 4.25rem) * 16 / 9)"
                        : "calc((100dvh - var(--player-chrome-h) - 9.5rem) * 16 / 9)",
                    }
              }
              className={
                isPip
                  ? "relative aspect-video w-full overflow-hidden bg-black"
                  : cn(
                      "relative mx-auto aspect-video w-full overflow-hidden bg-[#070708]",
                      cinema ? "rounded-none sm:rounded-xl" : "rounded-none sm:rounded-2xl",
                    )
              }
            >
              {item.platform === "twitch" && item.type !== "clip" && !twitchNeedsVideoId && (
                <div ref={twitchContainerRef} className="h-full w-full" />
              )}

              {item.platform === "twitch" && item.type === "clip" && (
                <iframe
                  src={`https://clips.twitch.tv/embed?clip=${encodeURIComponent(item.clipId || "")}&parent=${encodeURIComponent(hostname)}&autoplay=true`}
                  className="h-full w-full border-0"
                  allowFullScreen
                  allow="autoplay; fullscreen"
                  title={item.title}
                />
              )}

              {useKickHls && (
                <video
                  ref={hlsVideoRef}
                  controls
                  autoPlay
                  playsInline
                  poster={item.thumbnailUrl || undefined}
                  className="h-full w-full bg-black object-contain"
                />
              )}

              {item.platform === "youtube" && (
                <div ref={ytMountRef} className="yt-mount h-full w-full" />
              )}

              {item.platform === "kick" && item.type === "live" && (
                <iframe
                  src={`https://player.kick.com/${encodeURIComponent(item.channelSlug)}?autoplay=true`}
                  className="h-full w-full border-0"
                  allowFullScreen
                  allow="autoplay; fullscreen; picture-in-picture"
                  title={item.title}
                />
              )}

              {(twitchNeedsVideoId || kickVodWithoutSource || youtubeOffline || playerError) && (
                <PlayerFallback
                  thumbnail={item.thumbnailUrl}
                  title={
                    playerError
                      ? "Não deu para carregar o vídeo aqui"
                      : youtubeOffline
                        ? `${item.channelName} não está ao vivo agora`
                        : "O VOD ainda está sendo processado"
                  }
                  body={
                    playerError
                      ? "Abra direto na plataforma — o ponto onde você parou vai junto quando possível."
                      : youtubeOffline
                        ? "Os vídeos novos do canal aparecem no seu feed. Você recebe aviso quando entrar ao vivo."
                        : "Ele aparece no feed em instantes. Enquanto isso, dá para abrir a página de vídeos do canal."
                  }
                  href={item.url}
                  platform={item.platform}
                />
              )}

              {item.type === "live" && (
                <div
                  className={cn(
                    "pointer-events-none absolute flex items-center gap-1.5",
                    isPip ? "top-2 left-2" : "top-3 left-3",
                  )}
                >
                  <span className="rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-white">
                    Ao vivo
                  </span>
                  {liveStatus?.viewerCount ? (
                    <span className="tabular rounded-md bg-black/70 backdrop-blur px-1.5 py-0.5 text-[11px] sm:text-[12px] font-medium text-white">
                      {formatViewerCount(liveStatus.viewerCount)}
                    </span>
                  ) : null}
                </div>
              )}

              {/* Prevent iframes from swallowing pointermove while dragging the floating PiP */}
              {isPip && draggingPip && <div className="absolute inset-0 z-30 cursor-grabbing" />}

              {/* Compact hover controls over the PiP video */}
              {isPip && !draggingPip && (
                <div className="pointer-events-none absolute top-2 right-2 z-20 flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover/pip:opacity-100 transition-opacity duration-200">
                  {onExpandFromPip && (
                    <button
                      onClick={onExpandFromPip}
                      className="pointer-events-auto press flex h-7 w-7 items-center justify-center rounded-full bg-black/75 backdrop-blur-md ring-1 ring-inset ring-white/[0.14] text-white/90 hover:text-white"
                      aria-label="Expandir player"
                      title="Expandir player (P)"
                    >
                      <Expand className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={onClose ?? onBack}
                    className="pointer-events-auto press flex h-7 w-7 items-center justify-center rounded-full bg-black/75 backdrop-blur-md ring-1 ring-inset ring-white/[0.14] text-white/80 hover:text-white"
                    aria-label="Fechar mini player"
                    title="Fechar"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* 2px progress hairline on the bottom of the PiP video for VODs */}
              {isPip && isVod && duration > 0 && (
                <div className="pointer-events-none absolute bottom-0 inset-x-0 h-[2.5px] bg-white/15">
                  <div
                    className="h-full origin-left bg-[#53FC18]"
                    style={{ transform: `scaleX(${progressFraction})` }}
                  />
                </div>
              )}
            </div>
          </div>

          {isPip ? (
            <div
              onPointerDown={handlePipDragStart}
              className="touch-none cursor-grab active:cursor-grabbing select-none flex items-center gap-2.5 border-t border-white/[0.07] bg-white/[0.02] px-3 py-2"
              title="Arraste para mover de canto ou clique para expandir"
            >
              <div
                data-pip-expand="true"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onExpandFromPip?.();
                  }
                }}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left group"
              >
                <img
                  src={item.channelAvatar}
                  alt=""
                  draggable={false}
                  className="h-7 w-7 shrink-0 rounded-full object-cover bg-white/5 ring-1 ring-white/[0.1]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] font-semibold text-white group-hover:text-[#53FC18] transition-colors">
                      {item.channelName}
                    </span>
                    <PlatformBadge platform={item.platform} size="xs" />
                  </div>
                  <div className="truncate text-[11px] text-white/45">
                    {isVod && duration > 0
                      ? `${formatDuration(currentTime)} / ${formatDuration(duration)} · ${item.title}`
                      : item.title}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <span className="hidden sm:flex h-7 w-5 items-center justify-center text-white/25">
                  <GripHorizontal className="h-3.5 w-3.5" />
                </span>
                <button
                  onClick={() => setPipLarge((v) => !v)}
                  className="press hidden sm:flex h-7 w-7 items-center justify-center rounded-full text-white/55 hover:bg-white/[0.08] hover:text-white"
                  aria-label={pipLarge ? "Tamanho compacto" : "Aumentar mini player"}
                  title={pipLarge ? "Tamanho compacto" : "Aumentar mini player"}
                >
                  {pipLarge ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" />
                  )}
                </button>
                {onExpandFromPip && (
                  <button
                    onClick={onExpandFromPip}
                    className="press flex h-7 w-7 items-center justify-center rounded-full text-white/75 hover:bg-white/[0.1] hover:text-white"
                    aria-label="Voltar para tela cheia do player"
                    title="Expandir (P)"
                  >
                    <Expand className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={onClose ?? onBack}
                  className="press flex h-7 w-7 items-center justify-center rounded-full text-white/55 hover:bg-red-500/15 hover:text-red-400"
                  aria-label="Fechar mini player"
                  title="Fechar"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div
              className={cn("mx-auto w-full space-y-4", cinema && "px-3 sm:px-5")}
              style={{
                maxWidth: cinema
                  ? "calc((100dvh - var(--player-chrome-h) - 4.25rem) * 16 / 9)"
                  : "calc((100dvh - var(--player-chrome-h) - 9.5rem) * 16 / 9)",
              }}
            >
              {/* VOD progress — compositor-only (scaleX), springs toward the new value */}
              {isVod && duration > 0 && (
                <div className="space-y-1.5">
                  <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
                    <motion.div
                      className="h-full w-full origin-left rounded-full bg-[#53FC18]"
                      initial={false}
                      animate={{ transform: `scaleX(${isMarkedWatched ? 1 : progressFraction})` }}
                      transition={BENJI_SPRING}
                    />
                  </div>
                  <div className="tabular flex items-center justify-between text-[12px] text-white/40">
                    <span>
                      {isMarkedWatched
                        ? `Marcado como visto · ${formatDuration(duration)}`
                        : `${formatDuration(currentTime)} de ${formatDuration(duration)} · salvo automaticamente`}
                    </span>
                    {progress?.source === "extension" && <span>sincronizado pela extensão</span>}
                  </div>
                </div>
              )}

              {/* Title + meta */}
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={onOpenChannel}
                      disabled={!onOpenChannel}
                      className={cn(
                        "flex items-center gap-3 min-w-0 text-left",
                        onOpenChannel && "group cursor-pointer",
                      )}
                      title={onOpenChannel ? `Ver VODs e vídeos de ${item.channelName}` : undefined}
                    >
                      <img
                        src={item.channelAvatar}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full object-cover bg-white/5 ring-1 ring-white/[0.08]"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[15px] font-semibold text-white truncate group-hover:underline">
                            {item.channelName}
                          </span>
                          <PlatformBadge platform={item.platform} size="xs" />
                        </div>
                        <div className="text-[13px] text-white/45 truncate">
                          {item.type === "live"
                            ? [
                                item.category,
                                liveStatus?.startedAt &&
                                  `no ar há ${formatUptime(liveStatus.startedAt)}`,
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : `${item.type === "vod" ? "VOD" : "Clipe"} · ${formatRelativeDate(item.createdAt)}`}
                        </div>
                      </div>
                    </button>
                  </div>

                  <h1 className="text-[19px] sm:text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-white">
                    {item.title}
                  </h1>

                  {/* phones: one swipeable row of chips; larger screens wrap */}
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar overscroll-x-contain -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible">
                    <ActionButton
                      onClick={() => onToggleBookmarkItem(item.id)}
                      active={isBookmarked}
                      icon={
                        <Bookmark
                          key={String(isBookmarked)}
                          className={cn("h-4 w-4", isBookmarked && "pop fill-current")}
                        />
                      }
                      label={isBookmarked ? "Salvo" : "Salvar"}
                    />
                    {isVod && onToggleWatched && (
                      <ActionButton
                        onClick={() => {
                          markedWatchedInSessionRef.current = !isMarkedWatched;
                          onToggleWatched(item);
                        }}
                        active={isMarkedWatched}
                        icon={
                          <CheckCircle2
                            key={String(isMarkedWatched)}
                            className={cn("h-4 w-4", isMarkedWatched && "pop")}
                          />
                        }
                        label={isMarkedWatched ? "Visto" : "Marcar visto"}
                      />
                    )}
                    {isVod && (
                      <ActionButton
                        onClick={() => {
                          handleAddBookmark();
                          setActiveTab("moments");
                        }}
                        icon={<Flag className="h-4 w-4" />}
                        label={`Marcar ${formatDuration(currentTime)}`}
                      />
                    )}
                    <span className="hidden xl:contents">
                      <ActionButton
                        onClick={toggleCinema}
                        active={cinema}
                        icon={<RectangleHorizontal className="h-4 w-4" />}
                        label={cinema ? "Sair do cinema" : "Modo cinema"}
                      />
                    </span>
                    <ActionButton
                      onClick={handleShare}
                      icon={
                        copiedShare ? (
                          <Check className="pop h-4 w-4 text-[#53FC18]" />
                        ) : (
                          <Share2 className="h-4 w-4" />
                        )
                      }
                      label={copiedShare ? "Link copiado" : "Compartilhar"}
                    />
                    {item.type === "live" && (
                      <ActionButton
                        onClick={() => onAddToMulti(item)}
                        active={inMulti}
                        icon={
                          inMulti ? (
                            <Check className="pop h-4 w-4" />
                          ) : (
                            <LayoutGrid className="h-4 w-4" />
                          )
                        }
                        label={inMulti ? "No multistream" : "Multistream"}
                      />
                    )}
                    {item.type !== "clip" && !item.id.startsWith("ended-vod:") && (
                      <a
                        href={streamKeepUrl(item)}
                        title={
                          item.type === "live"
                            ? "Abre o StreamKeep e grava a live no seu PC — fica salva mesmo se o VOD sumir"
                            : "Abre o StreamKeep e baixa este VOD"
                        }
                        className="press hidden sm:inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium bg-white/[0.07] text-white/85 hover:bg-white/[0.12]"
                      >
                        {item.type === "live" ? (
                          <CircleDot className="h-4 w-4 text-red-500" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        {item.type === "live" ? "Gravar no StreamKeep" : "Baixar no StreamKeep"}
                      </a>
                    )}
                    {supportsSpeedControl && (
                      <ActionButton
                        onClick={handleCycleSpeed}
                        active={Math.abs(playbackRate - 1) >= 0.01}
                        icon={<Gauge className="h-4 w-4" />}
                        label={`${Number(playbackRate.toFixed(2))}x`}
                      />
                    )}
                    {isVod && (
                      <ActionButton
                        onClick={() => handleSeekTo(0)}
                        icon={<RotateCcw className="h-4 w-4" />}
                        label="Do início"
                      />
                    )}
                  </div>
                </div>

                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "shrink-0 self-start lg:self-auto inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 sm:px-5 sm:py-3 text-[13px] sm:text-[14px] font-semibold",
                    `liquid-glass-cta-${item.platform}`,
                  )}
                >
                  {isVod && currentTime > MIN_RESUME_SECONDS
                    ? `Abrir ${PLATFORM_IN[item.platform]} em ${formatDuration(currentTime)}`
                    : `Abrir ${PLATFORM_IN[item.platform]}`}
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Side panel — beside the video; hidden in PiP mode */}
        {!isPip && (
          <aside
            className={cn(
              "rounded-2xl bg-[#0c0c0e] border border-white/[0.06] overflow-hidden flex flex-col transition-[top,height] duration-[260ms] ease-[var(--ease-out)]",
              cinema
                ? "h-[560px] w-full max-w-[960px] mx-auto"
                : "xl:h-[calc(100dvh-var(--chrome-h)-4rem)] xl:min-h-[520px] xl:sticky xl:top-[calc(var(--chrome-h)+0.75rem)]",
            )}
          >
          <div className="flex items-center gap-0.5 p-1.5 border-b border-white/[0.06]">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-pressed={active}
                  className={cn(
                    "relative flex-1 rounded-full py-1.5 text-[13px] font-medium transition-colors",
                    active ? "text-white" : "text-white/45 hover:text-white/80",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="theater-tab-pill"
                      transition={BENJI_SPRING}
                      className="absolute inset-0 rounded-full bg-white/[0.1]"
                    />
                  )}
                  <span className="relative">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {activeTab === "chat" && (
              <div className="h-[480px] xl:h-full flex flex-col">
                <iframe
                  src={
                    item.platform === "twitch"
                      ? `https://www.twitch.tv/embed/${encodeURIComponent(item.channelSlug)}/chat?darkpopout&parent=${encodeURIComponent(hostname)}`
                      : item.platform === "youtube"
                        ? `https://www.youtube.com/live_chat?v=${encodeURIComponent(item.videoId || "")}&embed_domain=${encodeURIComponent(hostname)}&dark_theme=1`
                        : `https://kick.com/popout/${encodeURIComponent(item.channelSlug)}/chat`
                  }
                  className="flex-1 w-full border-0 bg-[#0c0c0e]"
                  title={`Chat de ${item.channelName}`}
                />
                {item.platform === "kick" && (
                  <a
                    href={`https://kick.com/popout/${encodeURIComponent(item.channelSlug)}/chat`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1 border-t border-white/[0.06] py-2 text-[12px] text-white/45 hover:text-white"
                  >
                    Chat não carregou? Abrir em janela <ArrowUpRight className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}

            {activeTab === "about" && (
              <div className="enter p-4 space-y-5">
                <p className="text-[14px] leading-relaxed text-white/70">
                  {item.summary ||
                    `${item.type === "live" ? "Transmissão" : item.type === "vod" ? (item.platform === "youtube" ? "Vídeo" : "Gravação") : "Clipe"} de ${item.channelName} ${
                      PLATFORM_IN[item.platform]
                    }${item.category && !["Ao vivo", "VOD", "Clipe"].includes(item.category) ? `, em ${item.category}` : ""}.`}
                </p>

                {(item.tags?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(new Set(item.tags)).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[12px] text-white/60"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <button
                  onClick={onOpenExtensionModal}
                  className="press w-full hidden sm:flex items-center gap-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.07] p-3.5 text-left"
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      extensionConnected
                        ? "bg-[#53FC18]/15 text-[#53FC18]"
                        : "bg-white/[0.07] text-white",
                    )}
                  >
                    <Puzzle className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-white">
                      {extensionConnected ? "Extensão conectada" : "Instalar a extensão"}
                    </span>
                    <span className="block text-[12px] text-white/45 leading-snug">
                      {extensionConnected
                        ? "O progresso na Twitch e na Kick sincroniza com o Streamex."
                        : "Para lembrar onde parou mesmo assistindo na Twitch.tv ou Kick.com."}
                    </span>
                  </span>
                </button>
              </div>
            )}

            {activeTab === "moments" && (
              <div className="enter p-4 space-y-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={bookmarkLabel}
                    onChange={(e) => setBookmarkLabel(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddBookmark()}
                    placeholder={`Nomear ${formatDuration(currentTime)}`}
                    className="min-w-0 flex-1 rounded-full bg-white/[0.06] px-3.5 py-2 text-[16px] sm:text-[13px] text-white placeholder:text-white/35 focus:bg-white/[0.09] focus:outline-none"
                  />
                  <button
                    onClick={handleAddBookmark}
                    className="press shrink-0 rounded-full bg-white text-black px-4 py-2 text-[13px] font-semibold hover:bg-white/90"
                  >
                    Marcar
                  </button>
                </div>

                {(progress?.bookmarks ?? []).length === 0 ? (
                  <p className="py-6 text-center text-[13px] leading-relaxed text-white/40">
                    Marque momentos para voltar neles depois.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {(progress?.bookmarks ?? [])
                      .slice()
                      .sort((a, b) => a.time - b.time)
                      .map((bm) => (
                        <li
                          key={bm.id}
                          className="enter group flex items-center gap-2 rounded-xl hover:bg-white/[0.04] pr-1"
                        >
                          <button
                            onClick={() => handleSeekTo(bm.time)}
                            className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left"
                          >
                            <span className="tabular shrink-0 rounded-md bg-[#53FC18]/12 px-1.5 py-0.5 text-[12px] font-medium text-[#53FC18]">
                              {formatDuration(bm.time)}
                            </span>
                            <span className="truncate text-[13px] text-white/80">{bm.label}</span>
                          </button>
                          <button
                            onClick={() => handleDeleteBookmark(bm.id)}
                            className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/35 hover:bg-red-500/15 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                            aria-label="Remover momento"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}

            {activeTab === "more" && (
              <div className="enter p-2 space-y-0.5">
                {moreItems.length === 0 ? (
                  <p className="p-6 text-center text-[13px] text-white/40">
                    Nada mais por enquanto.
                  </p>
                ) : (
                  moreItems.map((rel) => (
                    <button
                      key={rel.id}
                      onClick={() => onSelectItem(rel)}
                      className="press-card group w-full flex items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-white/[0.05]"
                    >
                      <div className="relative h-[54px] w-24 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
                        {rel.thumbnailUrl ? (
                          <img
                            src={rel.thumbnailUrl}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-300 ease-[var(--ease-out)] group-hover:scale-[1.04]"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-white/25">
                            <Play className="h-4 w-4" />
                          </div>
                        )}
                        <span
                          className={cn(
                            "tabular absolute bottom-1 right-1 rounded px-1 text-[10px] font-semibold",
                            rel.type === "live"
                              ? "bg-red-600 text-white"
                              : "bg-black/80 text-white",
                          )}
                        >
                          {rel.type === "live" ? "AO VIVO" : formatDuration(rel.durationSeconds)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium leading-snug text-white line-clamp-2">
                          {rel.title}
                        </div>
                        <div className="mt-0.5 text-[12px] text-white/40 truncate">
                          {rel.channelName} · {formatRelativeDate(rel.createdAt)}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {prevItem && nextItem && (
            <div className="grid grid-cols-2 gap-1.5 border-t border-white/[0.06] p-1.5">
              <button
                onClick={() => onSelectItem(prevItem)}
                className="press flex items-center justify-center gap-1 rounded-full px-3 py-2 text-[13px] text-white/60 hover:bg-white/[0.06] hover:text-white min-w-0"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span className="truncate">Anterior</span>
              </button>
              <button
                onClick={() => onSelectItem(nextItem)}
                className="press flex items-center justify-center gap-1 rounded-full px-3 py-2 text-[13px] text-white/60 hover:bg-white/[0.06] hover:text-white min-w-0"
              >
                <span className="truncate">Próximo</span>
                <ChevronRight className="h-4 w-4 shrink-0" />
              </button>
            </div>
          )}
          </aside>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  icon,
  label,
  active,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "press tabular shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium",
        active ? "bg-white text-black" : "bg-white/[0.07] text-white/85 hover:bg-white/[0.12]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function PlayerFallback({
  thumbnail,
  title,
  body,
  href,
  platform,
}: {
  thumbnail: string;
  title: string;
  body: string;
  href: string;
  platform: FeedItem["platform"];
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {thumbnail && (
        <img
          src={thumbnail}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-25 blur-sm"
        />
      )}
      <div className="relative max-w-sm px-6 text-center">
        <h2 className="text-[17px] font-semibold text-white">{title}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">{body}</p>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "mt-4 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold",
            `liquid-glass-cta-${platform}`,
          )}
        >
          Abrir {PLATFORM_IN[platform]}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

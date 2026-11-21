"use client";

import React, { useEffect, useRef, useState } from "react";
import type { FeedItem } from "@/types/streamex";
import { cn } from "@/lib/utils";
import { loadTwitchSdk } from "@/lib/twitch-sdk";

/** Hover intent: wait this long before loading a player, so sweeping the mouse across the grid is free. */
export const PREVIEW_DELAY_MS = 450;

/** Twitch refuses to play embeds smaller than 400×300, so its player renders at this size and is scaled down. */
const TWITCH_RENDER_W = 640;
const TWITCH_RENDER_H = 360;

/** True only for devices with a real hover (mouse/trackpad). Touch never gets previews. */
export function canHoverPreview() {
  return (
    typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}

function twitchTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`;
}

/**
 * Muted inline preview of a live, VOD or clip, layered over the card thumbnail.
 * Invisible until the stream actually plays, then fades in (opacity only), so the thumbnail
 * never flashes to black. Pointer events pass through to the card underneath.
 *
 * - Kick (live, VOD, clip): raw HLS in a <video>. Kick's embed doesn't autoplay at card size.
 *   Live uses /api/kick-live, which proxies the master playlist (it has no CORS header).
 * - Twitch: the official embed, rendered at 640×360 and scaled to the card.
 */
export function HoverPreview({ item, startAt = 0 }: { item: FeedItem; startAt?: number }) {
  const [ready, setReady] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [scale, setScale] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const twitchMountRef = useRef<HTMLDivElement | null>(null);
  // Decided once per hover. A live item's duration changes on every 2s poll, so depending on it
  // would tear the stream down and reload it every two seconds.
  const [startPosition] = useState(() =>
    item.type === "live"
      ? -1
      : startAt > 0
        ? startAt
        : item.type === "vod"
          ? Math.min(600, item.durationSeconds * 0.1)
          : 0,
  );
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";

  const hlsSrc =
    item.platform === "kick"
      ? item.type === "live"
        ? `/api/kick-live?slug=${encodeURIComponent(item.channelSlug)}`
        : item.hlsUrl || ""
      : "";

  // Twitch live/VOD go through the official JS player (it reports PLAYING); clips only have an iframe.
  const twitchVideo =
    item.platform === "twitch" && item.type === "vod" && item.videoId
      ? item.videoId.startsWith("v")
        ? item.videoId
        : `v${item.videoId}`
      : null;
  const twitchChannel =
    item.platform === "twitch" && item.type === "live" ? item.channelSlug : null;
  const usesTwitchSdk = Boolean(twitchVideo || twitchChannel);
  const iframeSrc =
    item.platform === "twitch" && item.type === "clip" && item.clipId
      ? `https://clips.twitch.tv/embed?clip=${encodeURIComponent(item.clipId)}&parent=${host}&autoplay=true&muted=true`
      : item.platform === "youtube" && item.videoId
        ? `https://www.youtube.com/embed/${encodeURIComponent(item.videoId)}?autoplay=1&mute=1&controls=0&playsinline=1&modestbranding=1${
            item.type === "vod" && startAt > 0 ? `&start=${Math.floor(startAt)}` : ""
          }`
        : "";
  const scaled = usesTwitchSdk || Boolean(iframeSrc);

  useEffect(() => {
    if (!usesTwitchSdk) return;
    let destroyed = false;
    const mount = twitchMountRef.current;
    loadTwitchSdk()
      .then(() => {
        if (destroyed || !mount || !window.Twitch?.Player) return;
        const options: Record<string, unknown> = {
          width: TWITCH_RENDER_W,
          height: TWITCH_RENDER_H,
          parent: [window.location.hostname || "localhost"],
          autoplay: true,
          muted: true,
          controls: false,
        };
        if (twitchVideo) {
          options.video = twitchVideo;
          if (startAt > 0) options.time = twitchTime(startAt);
        } else {
          options.channel = twitchChannel;
        }
        const player = new window.Twitch.Player(mount, options);
        player.addEventListener(window.Twitch.Player.PLAYING, () => {
          if (!destroyed) setReady(true);
        });
      })
      .catch(() => undefined);
    return () => {
      destroyed = true;
      if (mount) mount.innerHTML = "";
    };
  }, [usesTwitchSdk, twitchVideo, twitchChannel, startAt]);

  // Scale factor for the oversized Twitch embed.
  useEffect(() => {
    if (!scaled || !boxRef.current) return;
    const el = boxRef.current;
    const update = () => setScale(el.clientWidth / TWITCH_RENDER_W);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scaled]);

  // Kick: muted HLS, started at the saved position (or a bit into a VOD).
  useEffect(() => {
    if (!hlsSrc) return;
    const video = videoRef.current;
    if (!video) return;
    let destroyed = false;
    let hls: { destroy: () => void } | null = null;
    const start = startPosition;

    (async () => {
      // Native HLS where available (phones/Safari) — no library needed.
      if (video.canPlayType("application/vnd.apple.mpegurl") && hlsSrc.includes(".m3u8")) {
        video.src = hlsSrc;
        if (start > 0) {
          video.addEventListener("loadedmetadata", () => (video.currentTime = start), {
            once: true,
          });
        }
        return;
      }
      const Hls = (await import("hls.js")).default;
      if (destroyed) return;
      if (Hls.isSupported() && (hlsSrc.includes(".m3u8") || item.type === "live")) {
        const h = new Hls({
          startPosition: start,
          maxBufferLength: 6,
          capLevelToPlayerSize: true,
          startLevel: 0,
          liveSyncDurationCount: 2,
        });
        h.loadSource(hlsSrc);
        h.attachMedia(video);
        hls = h;
        return;
      }
      // Safari plays HLS natively; mp4 clips play anywhere.
      video.src = hlsSrc;
      if (start > 0) {
        video.addEventListener("loadedmetadata", () => (video.currentTime = start), { once: true });
      }
    })();

    return () => {
      destroyed = true;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [hlsSrc, startPosition, item.type]);

  // Twitch gates classified streams (GTA, CS…) behind a click in embeds, and its HLS refuses
  // other origins, so some previews never start. Say so instead of looking broken.
  useEffect(() => {
    const t = window.setTimeout(() => setStalled(true), 5000);
    return () => window.clearTimeout(t);
  }, []);

  if (!hlsSrc && !scaled) return null;

  if (stalled && !ready) {
    return (
      <span className="enter pointer-events-none absolute bottom-2.5 left-2.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] text-white/70 backdrop-blur">
        Prévia indisponível
      </span>
    );
  }

  return (
    <div
      ref={boxRef}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden bg-black transition-opacity duration-200",
        ready ? "opacity-100" : "opacity-0",
      )}
    >
      {hlsSrc ? (
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          onPlaying={() => setReady(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          style={{
            width: TWITCH_RENDER_W,
            height: TWITCH_RENDER_H,
            transform: `scale(${scale || 0.0001})`,
            transformOrigin: "top left",
          }}
        >
          {usesTwitchSdk ? (
            <div ref={twitchMountRef} className="h-full w-full" />
          ) : (
            <iframe
              src={iframeSrc}
              title=""
              tabIndex={-1}
              allow="autoplay"
              // clips have no JS API; "load" fires before the video paints, so wait a moment
              onLoad={() => window.setTimeout(() => setReady(true), 1200)}
              className="h-full w-full border-0"
            />
          )}
        </div>
      )}
    </div>
  );
}

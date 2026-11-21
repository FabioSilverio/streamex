"use client";

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowUpRight, Play, Radio, RefreshCw, Star } from "lucide-react";
import type { FeedItem, LiveChannelStatus, WatchProgress } from "@/types/streamex";
import {
  BENJI_SPRING,
  buildProgressKey,
  channelUrl,
  cn,
  formatViewerCount,
  PLATFORM_IN,
  PLATFORM_RING,
} from "@/lib/utils";
import { findLiveCheckpointForBroadcast } from "@/lib/progress";
import { PlatformBadge } from "@/components/StreamexLogo";
import { FeedCard } from "@/components/FeedGrid";

type ChannelTab = "all" | "vod" | "clip";

interface ChannelViewProps {
  channel: LiveChannelStatus;
  items: FeedItem[];
  loading: boolean;
  isFavorite: boolean;
  progressMap: Record<string, WatchProgress>;
  multiIds: string[];
  onBack: () => void;
  onRefresh: () => void;
  onToggleFavorite: (id: string) => void;
  onWatchLive: (channel: LiveChannelStatus) => void;
  onSelectItem: (item: FeedItem) => void;
  onAddToMulti: (item: FeedItem) => void;
  onToggleWatched: (item: FeedItem) => void;
}

export function ChannelView({
  channel,
  items,
  loading,
  isFavorite,
  progressMap,
  multiIds,
  onBack,
  onRefresh,
  onToggleFavorite,
  onWatchLive,
  onSelectItem,
  onAddToMulti,
  onToggleWatched,
}: ChannelViewProps) {
  const [tab, setTab] = useState<ChannelTab>("all");

  const nonLive = useMemo(() => items.filter((i) => i.type !== "live"), [items]);
  const vodsCount = useMemo(() => nonLive.filter((i) => i.type === "vod").length, [nonLive]);
  const clipsCount = useMemo(() => nonLive.filter((i) => i.type === "clip").length, [nonLive]);

  const visible = useMemo(() => {
    if (tab === "vod") return nonLive.filter((i) => i.type === "vod");
    if (tab === "clip") return nonLive.filter((i) => i.type === "clip");
    return nonLive;
  }, [nonLive, tab]);

  const vodLabel = channel.platform === "youtube" ? "Vídeos" : "VODs";
  const tabs: Array<{ id: ChannelTab; label: string; count: number }> = [
    { id: "all", label: "Tudo", count: nonLive.length },
    { id: "vod", label: vodLabel, count: vodsCount },
    ...(clipsCount > 0 ? [{ id: "clip" as const, label: "Clipes", count: clipsCount }] : []),
  ];

  return (
    <div className="enter mx-auto w-full max-w-[1520px] px-4 sm:px-6 pt-3 sm:pt-5 pb-20 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="press inline-flex items-center gap-1.5 rounded-full pl-2 pr-3.5 py-1.5 text-[14px] font-medium text-white/70 hover:bg-white/[0.06] hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao feed
        </button>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="press inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.11] px-3.5 py-1.5 text-[13px] font-medium text-white/80 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Atualizar
        </button>
      </div>

      {/* Apple-style channel header */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-3xl bg-white/[0.035] ring-1 ring-inset ring-white/[0.07] p-4 sm:p-5">
        <div className="flex items-center gap-4 min-w-0">
          <div className="relative shrink-0">
            <img
              src={channel.avatarUrl}
              alt=""
              className={cn(
                "h-14 w-14 sm:h-16 sm:w-16 rounded-full object-cover bg-white/5",
                channel.isLive
                  ? cn("ring-2 ring-offset-2 ring-offset-[#0b0b0d]", PLATFORM_RING[channel.platform])
                  : "ring-1 ring-white/[0.1]",
              )}
            />
            {channel.isLive && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white ring-2 ring-[#0b0b0d]">
                Live
              </span>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] sm:text-[24px] font-semibold tracking-[-0.02em] text-white truncate">
                {channel.displayName}
              </h1>
              <PlatformBadge platform={channel.platform} size="sm" showLabel />
            </div>
            <p className="mt-0.5 text-[13px] text-white/50 truncate">
              {channel.isLive ? (
                <>
                  Ao vivo agora ·{" "}
                  <span className="tabular text-white/75">
                    {formatViewerCount(channel.viewerCount)} assistindo
                  </span>
                  {channel.title ? ` · ${channel.title}` : ""}
                </>
              ) : (
                <>
                  {channel.platform === "youtube" ? "Canal do YouTube" : `@${channel.slug}`} ·
                  Offline agora
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {channel.isLive && (
            <button
              onClick={() => onWatchLive(channel)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold",
                `liquid-glass-cta-${channel.platform}`,
              )}
            >
              <Radio className="h-3.5 w-3.5" />
              Assistir ao vivo
            </button>
          )}

          <button
            onClick={() => onToggleFavorite(channel.id)}
            aria-pressed={isFavorite}
            className={cn(
              "press inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium",
              isFavorite
                ? "bg-[#FFD60A]/15 text-[#FFD60A] ring-1 ring-inset ring-[#FFD60A]/25"
                : "bg-white/[0.06] text-white/80 hover:bg-white/[0.11] hover:text-white",
            )}
          >
            <Star
              key={String(isFavorite)}
              className={cn("h-3.5 w-3.5", isFavorite && "pop fill-current")}
            />
            {isFavorite ? "Favorito" : "Favoritar"}
          </button>

          <a
            href={channelUrl(channel.platform, channel.slug)}
            target="_blank"
            rel="noopener noreferrer"
            className="press inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.11] px-3.5 py-2 text-[13px] font-medium text-white/80 hover:text-white"
          >
            Abrir {PLATFORM_IN[channel.platform]}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>

      {/* Tabs */}
      {tabs.length > 1 && (
        <div className="inline-flex items-center gap-0.5 rounded-full bg-white/[0.055] ring-1 ring-inset ring-white/[0.06] p-1">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-pressed={active}
                className={cn(
                  "relative shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  active ? "text-black" : "text-white/55 hover:text-white",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="channel-view-tab"
                    transition={BENJI_SPRING}
                    className="absolute inset-0 rounded-full bg-white"
                  />
                )}
                <span className="relative">{t.label}</span>
                {t.count > 0 && (
                  <span
                    className={cn(
                      "relative tabular text-[12px]",
                      active ? "text-black/45" : "text-white/30",
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Grid */}
      {loading && visible.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-x-4 gap-y-6">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className="animate-pulse">
              <div className="aspect-video rounded-2xl bg-white/[0.05]" />
              <div className="flex gap-3 pt-3">
                <div className="h-9 w-9 rounded-full bg-white/[0.05]" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 w-3/4 rounded bg-white/[0.06]" />
                  <div className="h-3 w-1/2 rounded bg-white/[0.04]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-3xl bg-white/[0.03] ring-1 ring-inset ring-white/[0.06] px-6 py-12 text-center">
          <Play className="mx-auto h-7 w-7 text-white/25" />
          <h2 className="mt-3 text-[16px] font-semibold text-white">
            Nenhum {channel.platform === "youtube" ? "vídeo" : "VOD"} recente encontrado
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-white/50">
            Este canal não tem gravações públicas disponíveis no momento, ou a API oficial ainda
            está carregando.
          </p>
          <a
            href={channelUrl(channel.platform, channel.slug)}
            target="_blank"
            rel="noopener noreferrer"
            className="press mt-5 inline-flex items-center gap-1.5 rounded-full bg-white text-black px-5 py-2 text-[13px] font-semibold hover:bg-white/90"
          >
            Abrir {PLATFORM_IN[channel.platform]}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-x-4 gap-y-6">
          {visible.map((item, index) => (
            <FeedCard
              key={item.id}
              index={index}
              item={item}
              progress={progressMap[buildProgressKey(item)]}
              liveCheckpoint={
                item.type === "live"
                  ? findLiveCheckpointForBroadcast(progressMap, {
                      platform: item.platform,
                      channelSlug: item.channelSlug,
                      startedAt: item.startedAt,
                      streamId: item.streamId,
                    })
                  : undefined
              }
              onSelect={() => onSelectItem(item)}
              inMulti={multiIds.includes(item.id)}
              onAddToMulti={onAddToMulti}
              onToggleWatched={onToggleWatched}
            />
          ))}
        </div>
      )}
    </div>
  );
}

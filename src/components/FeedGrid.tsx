"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  CircleDot,
  Download,
  LayoutGrid,
  Play,
  Search,
  UserRound,
  X,
} from "lucide-react";
import type {
  ApiHealth,
  FeedItem,
  LiveChannelStatus,
  Platform,
  WatchProgress,
} from "@/types/streamex";
import {
  BENJI_SPRING,
  buildProgressKey,
  cn,
  formatDuration,
  formatRelativeDate,
  formatViewerCount,
  channelUrl,
  getExternalPlatformUrl,
  PLATFORM_IN,
  streamKeepUrl,
} from "@/lib/utils";
import { PlatformBadge } from "@/components/StreamexLogo";
import { findLiveCheckpointForBroadcast, isResumable, isWatchedVod } from "@/lib/progress";
import { HoverPreview, PREVIEW_DELAY_MS, canHoverPreview } from "@/components/HoverPreview";

export type FeedTab = "all" | "live" | "vod" | "clip" | "continue" | "bookmarks";

interface FeedGridProps {
  items: FeedItem[];
  statuses: LiveChannelStatus[];
  progressMap: Record<string, WatchProgress>;
  bookmarkedIds: string[];
  activeTab: FeedTab;
  platformFilter: "all" | Platform;
  searchQuery: string;
  loadingFeed: boolean;
  apiHealth: ApiHealth;
  twitchConnected: boolean;
  onSearchChange: (q: string) => void;
  onChangeTab: (tab: FeedTab) => void;
  onChangePlatform: (p: "all" | Platform) => void;
  onSelectItem: (item: FeedItem) => void;
  onSelectChannel?: (ch: LiveChannelStatus) => void;
  onResumeProgress: (prog: WatchProgress) => void;
  onRemoveProgress: (key: string) => void;
  onMarkProgressWatched?: (prog: WatchProgress) => void;
  onToggleWatched?: (item: FeedItem) => void;
  onOpenApiModal: () => void;
  onOpenChannelsModal: () => void;
  multiIds: string[];
  onAddToMulti: (item: FeedItem) => void;
}

const QUICK_LIMIT = 24;
const PAGE_SIZE = 24;

export function FeedGrid({
  items,
  statuses,
  progressMap,
  bookmarkedIds,
  activeTab,
  platformFilter,
  searchQuery,
  loadingFeed,
  apiHealth,
  twitchConnected,
  onSearchChange,
  onChangeTab,
  onChangePlatform,
  onSelectItem,
  onSelectChannel,
  onResumeProgress,
  onRemoveProgress,
  onMarkProgressWatched,
  onToggleWatched,
  onOpenApiModal,
  onOpenChannelsModal,
  multiIds,
  onAddToMulti,
}: FeedGridProps) {
  const progressList = Object.values(progressMap)
    .filter(isResumable)
    .filter((p) => platformFilter === "all" || p.platform === platformFilter)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const q = searchQuery.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    if (platformFilter !== "all" && item.platform !== platformFilter) return false;
    if (activeTab === "live" && item.type !== "live") return false;
    if (activeTab === "vod" && item.type !== "vod") return false;
    if (activeTab === "clip" && item.type !== "clip") return false;
    if (activeTab === "bookmarks" && !bookmarkedIds.includes(item.id)) return false;
    if (
      q &&
      !`${item.title} ${item.channelName} ${item.channelSlug} ${item.category}`
        .toLowerCase()
        .includes(q)
    )
      return false;
    return true;
  });

  // Render the grid in pages: 300+ cards (and their images) at once is what made phones sluggish.
  // A sentinel near the end loads the next page before you reach it.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const resetKey = `${activeTab}|${platformFilter}|${q}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setVisibleCount(PAGE_SIZE);
  }
  const hasMore = filteredItems.length > visibleCount;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisibleCount((n) => n + PAGE_SIZE);
      },
      { rootMargin: "1200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, visibleCount]);

  const counts = {
    all: items.length,
    live: items.filter((i) => i.type === "live").length,
    vod: items.filter((i) => i.type === "vod").length,
    clip: items.filter((i) => i.type === "clip").length,
    continue: progressList.length,
    // Saved items that are no longer in the feed (e.g. a live that ended) can't be shown, so don't count them.
    bookmarks: items.filter((i) => bookmarkedIds.includes(i.id)).length,
  };

  const vodsUnavailable = apiHealth.twitch !== "official";
  const tabs = [
    { id: "continue", label: "Continuar" },
    { id: "all", label: "Tudo" },
    { id: "live", label: "Ao vivo" },
    { id: "vod", label: "VODs" },
    { id: "clip", label: "Clipes" },
    { id: "bookmarks", label: "Salvos" },
  ] as const;

  const sectionTitle = {
    all: "Para você",
    live: "Ao vivo agora",
    vod: "VODs recentes",
    clip: "Clipes da semana",
    bookmarks: "Salvos",
    continue: "",
  }[activeTab];

  return (
    <div className="mx-auto w-full max-w-[1520px] px-4 sm:px-6 pt-3 sm:pt-5 pb-16 space-y-6 sm:space-y-8">
      {/* Mobile search (the header search is desktop-only) */}
      <div className="relative md:hidden">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/35" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar canais, lives e VODs"
          enterKeyHint="search"
          className="w-full rounded-full bg-white/[0.07] pl-10 pr-10 py-2 text-[16px] text-white placeholder:text-white/35 focus:bg-white/[0.1] focus:outline-none"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-white/45"
            aria-label="Limpar busca"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="max-sm:edge-fade -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto no-scrollbar overscroll-x-contain">
          <div className="inline-flex items-center gap-0.5 rounded-full bg-white/[0.055] ring-1 ring-inset ring-white/[0.06] p-1">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              const count = counts[tab.id];
              return (
                <button
                  key={tab.id}
                  onClick={() => onChangeTab(tab.id)}
                  aria-pressed={active}
                  className={cn(
                    "relative shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                    active ? "text-black" : "text-white/55 hover:text-white",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="feed-main-tab"
                      transition={BENJI_SPRING}
                      className="absolute inset-0 rounded-full bg-white"
                    />
                  )}
                  {tab.id === "live" && counts.live > 0 && (
                    <span className="relative h-1.5 w-1.5 rounded-full bg-red-500" />
                  )}
                  <span className="relative">{tab.label}</span>
                  {count > 0 && tab.id !== "all" && (
                    <span
                      className={cn(
                        "relative tabular text-[12px]",
                        active ? "text-black/45" : "text-white/30",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="inline-flex self-start md:self-auto items-center gap-0.5 rounded-full bg-white/[0.055] ring-1 ring-inset ring-white/[0.06] p-1">
          {(
            [
              { id: "all", label: "Todas" },
              { id: "twitch", label: "Twitch" },
              { id: "kick", label: "Kick" },
              { id: "youtube", label: "YouTube" },
            ] as const
          ).map((p) => {
            const active = platformFilter === p.id;
            return (
              <button
                key={p.id}
                onClick={() => onChangePlatform(p.id)}
                aria-pressed={active}
                className={cn(
                  "relative rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  active ? "text-white" : "text-white/50 hover:text-white/85",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="platform-filter-pill"
                    transition={BENJI_SPRING}
                    className={cn(
                      "absolute inset-0 rounded-full",
                      p.id === "kick"
                        ? "bg-[#53FC18]/20"
                        : p.id === "twitch"
                          ? "bg-[#9146FF]/30"
                          : p.id === "youtube"
                            ? "bg-[#FF0033]/25"
                            : "bg-white/[0.12]",
                    )}
                  />
                )}
                <span className="relative">{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Connect prompt — only until the Twitch account is linked */}
      {!twitchConnected && activeTab === "all" && (
        <section className="enter flex flex-col sm:flex-row sm:items-center gap-4 rounded-3xl bg-gradient-to-br from-[#9146FF]/[0.16] to-white/[0.03] p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#9146FF]/25 text-[#D4BBFF]">
            <UserRound className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-white">
              Traga quem você já segue
            </h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-white/60">
              Conecte sua conta da Twitch e todos os canais seguidos entram aqui automaticamente.
              {vodsUnavailable && " VODs e clipes também aparecem com a API oficial ativa."}
            </p>
          </div>
          <button
            onClick={onOpenApiModal}
            className="press shrink-0 rounded-full bg-white text-black px-5 py-2.5 text-[14px] font-semibold hover:bg-white/90"
          >
            Conectar contas
          </button>
        </section>
      )}

      {/* Continue watching */}
      {progressList.length > 0 && (activeTab === "all" || activeTab === "continue") && (
        <section className="space-y-3">
          <SectionHeader title="Continuar assistindo" count={progressList.length} />
          <div
            className={cn(
              "gap-4",
              activeTab === "all"
                ? // phones: a swipeable rail with the next card peeking; tablets/desktop: grid
                  "flex overflow-x-auto snap-x snap-mandatory no-scrollbar overscroll-x-contain -mx-4 px-4 scroll-px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 sm:overflow-visible"
                : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
            )}
          >
            {progressList.slice(0, activeTab === "continue" ? 48 : 4).map((prog) => {
              const pct =
                prog.duration > 0 ? Math.min(100, (prog.currentTime / prog.duration) * 100) : 0;
              return (
                <div
                  key={prog.key}
                  className={cn(
                    "enter lift group relative",
                    activeTab === "all" && "w-[80%] shrink-0 snap-start sm:w-auto",
                  )}
                >
                  <button onClick={() => onResumeProgress(prog)} className="press-card w-full text-left">
                    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-[#0b0b0d] ring-1 ring-inset ring-white/[0.07]">
                      {prog.thumbnailUrl ? (
                        <img
                          src={prog.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-300 ease-[var(--ease-out)] sm:group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center">
                          <Play className="h-7 w-7 text-white/25" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                      <span className="tabular absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/70 backdrop-blur px-2.5 py-1 text-[12px] font-medium text-white">
                        <Play className="h-3 w-3 fill-current" />
                        {formatDuration(prog.currentTime)}
                        {prog.duration > 0 && (
                          <span className="text-white/50">/ {formatDuration(prog.duration)}</span>
                        )}
                      </span>
                      <div className="absolute bottom-0 inset-x-0 h-[3px] bg-white/15">
                        <div
                          className="h-full origin-left bg-[#53FC18]"
                          style={{ transform: `scaleX(${pct / 100})` }}
                        />
                      </div>
                    </div>
                    <div className="pt-2.5 px-0.5">
                      <div className="text-[14px] font-medium text-white line-clamp-1">
                        {prog.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-white/45">
                        <span className="truncate">{prog.channelName}</span>
                        <span aria-hidden>·</span>
                        <span className="shrink-0">
                          {formatRelativeDate(new Date(prog.updatedAt).toISOString())}
                        </span>
                        {prog.fromLive && (
                          <span className="shrink-0 text-[#53FC18]/80">· da live</span>
                        )}
                        {prog.source === "extension" && (
                          <span className="shrink-0 text-white/30">· extensão</span>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="absolute top-2 right-2 flex items-center gap-1.5 sm:opacity-0 sm:-translate-y-0.5 sm:group-hover:opacity-100 sm:group-hover:translate-y-0 sm:group-focus-within:opacity-100 sm:group-focus-within:translate-y-0 transition-[opacity,transform] duration-200 ease-[var(--ease-out)]">
                    {onMarkProgressWatched && (
                      <button
                        onClick={() => onMarkProgressWatched(prog)}
                        className="press flex h-7 items-center gap-1 rounded-full bg-black/75 backdrop-blur-md ring-1 ring-inset ring-white/[0.1] px-2.5 text-[11px] font-medium text-white/85 hover:text-[#53FC18]"
                        aria-label="Marcar como visto"
                        title="Marcar como visto (remove de Continuar assistindo)"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Visto
                      </button>
                    )}
                    <button
                      onClick={() => onRemoveProgress(prog.key)}
                      className="press flex h-7 w-7 items-center justify-center rounded-full bg-black/75 backdrop-blur-md ring-1 ring-inset ring-white/[0.1] text-white/70 hover:text-white"
                      aria-label="Remover de Continuar assistindo"
                      title="Remover"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {activeTab === "continue" && progressList.length === 0 && (
        <EmptyState
          title="Nada para continuar"
          body="Quando você assistir um VOD por aqui (ou na Twitch/Kick com a extensão), o ponto onde parou aparece nesta aba."
        />
      )}

      {/* Main grid */}
      {activeTab !== "continue" && (
        <section className="space-y-3">
          <SectionHeader title={sectionTitle} count={filteredItems.length} />

          {loadingFeed && filteredItems.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-x-4 gap-y-6">
              {Array.from({ length: 6 }).map((_, idx) => (
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
          ) : filteredItems.length === 0 ? (
            <EmptyState
              title={
                (activeTab === "vod" || activeTab === "clip") && vodsUnavailable
                  ? "VODs e clipes precisam da API oficial"
                  : q
                    ? `Nada encontrado para “${searchQuery.trim()}”`
                    : "Nada por aqui ainda"
              }
              body={
                (activeTab === "vod" || activeTab === "clip") && vodsUnavailable
                  ? "Com as chaves da Twitch configuradas, os VODs e clipes dos seus canais entram aqui sozinhos."
                  : "Abra qualquer canal pela barra lateral, mesmo offline, ou adicione novos canais."
              }
              actions={
                <>
                  {(activeTab === "vod" || activeTab === "clip") && vodsUnavailable && (
                    <button
                      onClick={onOpenApiModal}
                      className="press rounded-full bg-white text-black px-5 py-2 text-[13px] font-semibold hover:bg-white/90"
                    >
                      Configurar contas
                    </button>
                  )}
                  <button
                    onClick={onOpenChannelsModal}
                    className="press rounded-full bg-white/[0.08] hover:bg-white/[0.14] px-5 py-2 text-[13px] font-medium text-white"
                  >
                    Adicionar canais
                  </button>
                </>
              }
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-x-4 gap-y-6">
              {filteredItems.slice(0, visibleCount).map((item, index) => (
                <FeedCard
                  index={index % PAGE_SIZE}
                  key={item.id}
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
          {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
        </section>
      )}

      {/* Quick access to followed channels */}
      {activeTab === "all" && statuses.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <SectionHeader title="Seus canais" count={statuses.length} />
            <button
              onClick={onOpenChannelsModal}
              className="text-[13px] font-medium text-white/55 hover:text-white"
            >
              {statuses.length > QUICK_LIMIT ? "Ver todos" : "Editar"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {statuses.slice(0, QUICK_LIMIT).map((ch) => (
              <button
                key={ch.id}
                onClick={() => {
                  if (onSelectChannel) {
                    onSelectChannel(ch);
                    return;
                  }
                  onSelectItem({
                    id: `live:${ch.platform}:${ch.slug}`,
                    platform: ch.platform,
                    channelSlug: ch.slug,
                    channelName: ch.displayName,
                    channelAvatar: ch.avatarUrl,
                    type: "live",
                    title: ch.title || `Canal de ${ch.displayName}`,
                    category: ch.category || (ch.isLive ? "Ao vivo" : "Canal"),
                    thumbnailUrl: ch.thumbnailUrl,
                    durationSeconds: 0,
                    viewCount: ch.viewerCount,
                    createdAt: ch.startedAt || new Date().toISOString(),
                    startedAt: ch.startedAt || undefined,
                    streamId: ch.streamId || undefined,
                    url:
                      ch.platform === "youtube" && ch.streamId
                        ? `https://www.youtube.com/watch?v=${ch.streamId}`
                        : channelUrl(ch.platform, ch.slug),
                    videoId: ch.platform === "youtube" ? (ch.streamId ?? undefined) : undefined,
                  });
                }}
                className="press inline-flex items-center gap-2 rounded-full bg-white/[0.05] hover:bg-white/[0.1] pl-1 pr-3 py-1 text-[13px] text-white/75 hover:text-white"
              >
                <img
                  src={ch.avatarUrl}
                  alt=""
                  loading="lazy"
                  className={cn(
                    "h-6 w-6 rounded-full object-cover",
                    !ch.isLive && "opacity-60 grayscale",
                  )}
                />
                <span className="max-w-[140px] truncate">{ch.displayName}</span>
                {ch.isLive && (
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-label="ao vivo" />
                )}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-white">
      {title}
      {count !== undefined && count > 0 && (
        <span className="tabular ml-2 text-[14px] font-normal text-white/30">{count}</span>
      )}
    </h2>
  );
}

function EmptyState({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl bg-white/[0.03] px-6 py-12 text-center">
      <h3 className="text-[16px] font-semibold text-white">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-white/50">{body}</p>
      {actions && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function FeedCard({
  item,
  progress,
  liveCheckpoint,
  onSelect,
  inMulti,
  onAddToMulti,
  onToggleWatched,
  index = 0,
}: {
  index?: number;
  item: FeedItem;
  progress?: WatchProgress;
  liveCheckpoint?: WatchProgress;
  onSelect: () => void;
  inMulti?: boolean;
  onAddToMulti?: (item: FeedItem) => void;
  onToggleWatched?: (item: FeedItem) => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const startHover = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !canHoverPreview()) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setPreviewing(true), PREVIEW_DELAY_MS);
  };
  const endHover = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setPreviewing(false);
  };
  useEffect(
    () => () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  const watched = item.type === "vod" && isWatchedVod(progress);
  const pct = watched
    ? 100
    : progress && progress.duration > 0
      ? Math.min(100, (progress.currentTime / progress.duration) * 100)
      : 0;
  const showResume = item.type !== "live" && !watched && progress && progress.currentTime > 5;

  return (
    <article
      className="enter lift group relative"
      // first rows cascade in (35ms apart); later cards appear together
      style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
      onPointerEnter={startHover}
      onPointerLeave={endHover}
    >
      <button
        onClick={onSelect}
        className="press-card block w-full text-left"
        aria-label={`${item.channelName}: ${item.title}`}
      >
        <div
          data-vt="thumb"
          data-vt-id={item.id}
          className="relative aspect-video w-full overflow-hidden rounded-2xl bg-[#0b0b0d] ring-1 ring-inset ring-white/[0.07]"
        >
          {item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 ease-[var(--ease-out)] sm:group-hover:scale-[1.03]"
            />
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-white/25">
              <Play className="h-7 w-7" />
              <span className="text-[12px]">{item.channelName}</span>
            </div>
          )}

          {previewing && (
            <HoverPreview
              item={item}
              startAt={item.type === "vod" && progress ? progress.currentTime : 0}
            />
          )}

          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
            {item.type === "live" ? (
              <span className="tabular inline-flex items-center gap-1.5 rounded-md bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                Ao vivo
              </span>
            ) : watched ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-black/75 backdrop-blur-md ring-1 ring-inset ring-white/[0.1] px-1.5 py-0.5 text-[11px] font-medium text-[#53FC18]">
                <CheckCircle2 className="h-3 w-3" />
                Visto
              </span>
            ) : item.isNewlyFinishedVod ? (
              <span className="rounded-md bg-[#53FC18] px-1.5 py-0.5 text-[11px] font-semibold text-black">
                Novo VOD
              </span>
            ) : null}
          </div>

          {item.type === "live" && liveCheckpoint && (
            <div className="absolute bottom-2.5 left-2.5">
              <span className="tabular rounded-md bg-black/75 backdrop-blur-md ring-1 ring-inset ring-white/[0.1] px-1.5 py-0.5 text-[11px] font-medium text-[#53FC18]">
                Parou em {formatDuration(liveCheckpoint.currentTime)}
              </span>
            </div>
          )}

          <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
            {item.type === "live" ? (
              <span className="tabular rounded-md bg-black/70 backdrop-blur px-1.5 py-0.5 text-[12px] font-medium text-white">
                {formatViewerCount(item.viewCount)} assistindo
              </span>
            ) : (
              item.durationSeconds > 0 && (
                <span className="tabular rounded-md bg-black/70 backdrop-blur px-1.5 py-0.5 text-[12px] font-medium text-white">
                  {showResume ? `${formatDuration(progress!.currentTime)} / ` : ""}
                  {formatDuration(item.durationSeconds)}
                </span>
              )
            )}
          </div>

          {pct > 0 && item.type !== "live" && (
            <div className="absolute bottom-0 inset-x-0 h-[3px] bg-white/15">
              <div
                className="h-full origin-left bg-[#53FC18]"
                style={{ transform: `scaleX(${pct / 100})` }}
              />
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-3 px-0.5">
          <img
            src={item.channelAvatar}
            alt=""
            loading="lazy"
            className="h-9 w-9 shrink-0 rounded-full object-cover bg-white/5"
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-medium leading-snug text-white line-clamp-2">
              {item.title}
            </h3>
            <div className="mt-1 flex items-center gap-1.5 text-[12px] text-white/50">
              <PlatformBadge platform={item.platform} size="xs" />
              <span className="truncate font-medium text-white/65">{item.channelName}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-white/40 truncate">
              {item.type === "clip" ? "Clipe" : item.type === "vod" ? "VOD" : item.category}
              {item.type !== "live" && ` · ${formatRelativeDate(item.createdAt)}`}
              {item.type !== "live" &&
                item.viewCount > 0 &&
                ` · ${formatViewerCount(item.viewCount)} views`}
            </div>
          </div>
        </div>
      </button>

      <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 sm:opacity-0 sm:-translate-y-0.5 sm:group-hover:opacity-100 sm:group-hover:translate-y-0 sm:group-focus-within:opacity-100 sm:group-focus-within:translate-y-0 transition-[opacity,transform] duration-200 ease-[var(--ease-out)]">
        {item.type === "vod" && !item.id.startsWith("ended-vod:") && onToggleWatched && (
          <button
            onClick={() => onToggleWatched(item)}
            aria-pressed={watched}
            className={cn(
              "press flex h-7 items-center gap-1 rounded-full bg-black/75 backdrop-blur-md ring-1 ring-inset ring-white/[0.1] px-2.5 text-[12px] font-medium",
              watched ? "text-[#53FC18]" : "text-white/85 hover:text-white",
            )}
            aria-label={watched ? "Desmarcar como visto" : "Marcar como visto"}
            title={watched ? "Desmarcar como visto" : "Marcar como visto"}
          >
            <CheckCircle2 className={cn("h-3.5 w-3.5", watched && "pop")} />
            Visto
          </button>
        )}
        {item.type !== "clip" && !item.id.startsWith("ended-vod:") && (
          <a
            href={streamKeepUrl(item)}
            className="press hidden sm:flex h-7 items-center gap-1 rounded-full bg-black/70 backdrop-blur px-2.5 text-[12px] font-medium text-white/85 hover:text-white"
            aria-label={
              item.type === "live" ? "Gravar a live no StreamKeep" : "Baixar o VOD no StreamKeep"
            }
            title={
              item.type === "live"
                ? "Gravar no StreamKeep — guarda a live no seu PC mesmo se o VOD sumir"
                : "Baixar no StreamKeep"
            }
          >
            {item.type === "live" ? (
              <CircleDot className="h-3.5 w-3.5 text-red-500" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {item.type === "live" ? "Gravar" : "Baixar"}
          </a>
        )}
        {item.type === "live" && onAddToMulti && (
          <button
            onClick={() => onAddToMulti(item)}
            disabled={inMulti}
            className="press flex h-7 items-center gap-1 rounded-full bg-black/70 backdrop-blur px-2.5 text-[12px] font-medium text-white/85 hover:text-white disabled:text-[#53FC18]"
            aria-label={inMulti ? "Já está no multistream" : "Adicionar ao multistream"}
            title={inMulti ? "Já está no multistream" : "Adicionar ao multistream"}
          >
            {inMulti ? (
              <Check className="pop h-3.5 w-3.5" />
            ) : (
              <LayoutGrid className="h-3.5 w-3.5" />
            )}
            Multi
          </button>
        )}
        <a
          href={getExternalPlatformUrl(item, progress?.currentTime)}
          target="_blank"
          rel="noopener noreferrer"
          className="press flex h-7 w-7 items-center justify-center rounded-full bg-black/70 backdrop-blur text-white/80 hover:text-white"
          aria-label={`Abrir ${PLATFORM_IN[item.platform]}`}
          title={`Abrir ${PLATFORM_IN[item.platform]}`}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </article>
  );
}

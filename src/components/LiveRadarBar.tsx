"use client";

import React, { useState } from "react";
import { Plus, Star, UserRound } from "lucide-react";
import type { ApiHealth, LiveChannelStatus } from "@/types/streamex";
import { cn, formatUptime, formatViewerCount, PLATFORM_RING } from "@/lib/utils";
import { PlatformBadge } from "@/components/StreamexLogo";

interface LiveRadarBarProps {
  statuses: LiveChannelStatus[];
  selectedChannelKey: string | null;
  onSelectChannel: (status: LiveChannelStatus) => void;
  onOpenChannelsModal: () => void;
  onOpenApiModal: () => void;
  latencyMs: number;
  pollTick: number;
  apiHealth: ApiHealth;
  sidebarOpen: boolean;
  twitchConnected: boolean;
  favoriteIds: Set<string>;
  onToggleFavorite: (id: string) => void;
}

/** Favorites first, keeping the incoming order (live: most viewers first) otherwise. */
function favoritesFirst(list: LiveChannelStatus[], favs: Set<string>) {
  return [...list].sort((a, b) => Number(favs.has(b.id)) - Number(favs.has(a.id)));
}

function FavoriteButton({
  ch,
  isFav,
  onToggle,
}: {
  ch: LiveChannelStatus;
  isFav: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onToggle(ch.id)}
      aria-pressed={isFav}
      aria-label={isFav ? `Tirar ${ch.displayName} dos favoritos` : `Favoritar ${ch.displayName}`}
      title={isFav ? "Tirar dos favoritos" : "Favoritar"}
      className={cn(
        "press shrink-0 flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/[0.08] focus-visible:opacity-100 transition-opacity",
        isFav
          ? "text-[#FFD60A]"
          : "text-white/40 hover:text-white opacity-0 group-hover:opacity-100",
      )}
    >
      <Star key={String(isFav)} className={cn("h-3.5 w-3.5", isFav && "pop fill-current")} />
    </button>
  );
}

const ring = (p: LiveChannelStatus["platform"]) => PLATFORM_RING[p];

export function TopLiveStrip({
  statuses,
  selectedChannelKey,
  onSelectChannel,
  onOpenChannelsModal,
  latencyMs,
  favoriteIds,
}: Pick<
  LiveRadarBarProps,
  | "statuses"
  | "selectedChannelKey"
  | "onSelectChannel"
  | "onOpenChannelsModal"
  | "latencyMs"
  | "favoriteIds"
>) {
  const liveChannels = favoritesFirst(
    statuses.filter((s) => s.isLive),
    favoriteIds,
  );

  return (
    <div className="w-full">
      <div className="edge-fade flex h-10 items-center gap-2 px-4 overflow-x-auto no-scrollbar">
        <div className="shrink-0 flex items-center gap-2 pr-1">
          <span className="live-dot h-2 w-2 rounded-full bg-[#53FC18]" />
          <span className="tabular text-[13px] font-semibold text-white">
            {liveChannels.length} ao vivo
          </span>
          {latencyMs > 0 && (
            <span className="tabular hidden sm:inline text-[12px] text-white/35">
              {latencyMs} ms
            </span>
          )}
        </div>

        {liveChannels.map((ch) => {
          const isSelected = selectedChannelKey === `${ch.platform}:${ch.slug}`;
          return (
            <button
              key={ch.id}
              onClick={() => onSelectChannel(ch)}
              className={cn(
                "press enter shrink-0 flex items-center gap-2 rounded-full pl-1 pr-3 py-1 text-left",
                isSelected ? "bg-white/[0.14]" : "bg-white/[0.05] hover:bg-white/[0.1]",
              )}
            >
              <img
                src={ch.avatarUrl}
                alt=""
                className={cn(
                  "h-6 w-6 rounded-full object-cover ring-[1.5px] ring-offset-1 ring-offset-black",
                  ring(ch.platform),
                )}
              />
              <span className="text-[13px] font-medium text-white max-w-[120px] truncate">
                {ch.displayName}
              </span>
              {favoriteIds.has(ch.id) && (
                <Star
                  className="h-3 w-3 shrink-0 fill-[#FFD60A] text-[#FFD60A]"
                  aria-label="favorito"
                />
              )}
              <span className="tabular text-[12px] text-white/45">
                {formatViewerCount(ch.viewerCount)}
              </span>
            </button>
          );
        })}

        {liveChannels.length === 0 && statuses.length > 0 && (
          <span className="shrink-0 text-[13px] text-white/40 px-1">
            Ninguém ao vivo entre seus {statuses.length} canais
          </span>
        )}

        <button
          onClick={onOpenChannelsModal}
          className="press shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] text-white/55 hover:bg-white/[0.06] hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          Canal
        </button>
      </div>
    </div>
  );
}

const OFFLINE_PREVIEW = 12;

export function LiveSidebar({
  statuses,
  selectedChannelKey,
  onSelectChannel,
  onOpenChannelsModal,
  onOpenApiModal,
  sidebarOpen,
  twitchConnected,
  favoriteIds,
  onToggleFavorite,
}: LiveRadarBarProps) {
  const [showAllOffline, setShowAllOffline] = useState(false);
  const liveChannels = favoritesFirst(
    statuses.filter((s) => s.isLive),
    favoriteIds,
  );
  const offlineChannels = favoritesFirst(
    statuses.filter((s) => !s.isLive),
    favoriteIds,
  );
  const offlineVisible = showAllOffline
    ? offlineChannels
    : offlineChannels.slice(0, OFFLINE_PREVIEW);

  return (
    <aside
      aria-hidden={!sidebarOpen || undefined}
      style={{ viewTransitionName: "sidebar" }}
      className={cn(
        "hidden lg:flex shrink-0 flex-col bg-[#050506] self-start sticky top-[var(--chrome-h)] h-[calc(100dvh-var(--chrome-h))] overflow-hidden transition-[width,opacity,border-color,top,height] duration-[240ms] ease-[var(--ease-drawer)]",
        sidebarOpen
          ? "w-[264px] opacity-100 border-r border-white/[0.06]"
          : "w-0 opacity-0 border-r border-transparent pointer-events-none",
      )}
    >
      <div
        className={cn(
          "flex w-[264px] h-full flex-col transition-transform duration-[240ms] ease-[var(--ease-drawer)]",
          sidebarOpen ? "translate-x-0" : "-translate-x-4",
        )}
      >
        <div className="flex-1 overflow-y-auto overscroll-contain px-2.5 pt-3.5 pb-4 space-y-5">
          <section>
            <h2 className="px-2.5 mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-white/40">
              Ao vivo <span className="tabular ml-1 font-medium text-white/30">{liveChannels.length}</span>
            </h2>

            {liveChannels.length === 0 ? (
              <p className="px-2.5 py-2 text-[13px] leading-snug text-white/35">
                Nenhum canal ao vivo agora.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {liveChannels.map((ch) => {
                  const active = selectedChannelKey === `${ch.platform}:${ch.slug}`;
                  return (
                    <li
                      key={ch.id}
                      className={cn(
                        "enter group flex items-center rounded-xl pr-1 transition-colors",
                        active
                          ? "bg-white/[0.09] ring-1 ring-inset ring-white/[0.08]"
                          : "hover:bg-white/[0.05]",
                      )}
                    >
                      <button
                        onClick={() => onSelectChannel(ch)}
                        className="min-w-0 flex-1 flex items-center gap-2.5 px-2.5 py-2 text-left"
                      >
                        <img
                          src={ch.avatarUrl}
                          alt=""
                          className={cn(
                            "h-8 w-8 shrink-0 rounded-full object-cover ring-[1.5px] ring-offset-[1.5px] ring-offset-[#050506]",
                            ring(ch.platform),
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[14px] font-medium text-white truncate">
                              {ch.displayName}
                            </span>
                            <span className="tabular shrink-0 flex items-center gap-1 text-[12px] text-white/60">
                              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                              {formatViewerCount(ch.viewerCount)}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[12px] text-white/40 truncate">
                              {ch.category || "Ao vivo"}
                            </span>
                            {ch.startedAt && (
                              <span className="tabular shrink-0 text-[11px] text-white/30">
                                {formatUptime(ch.startedAt)}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                      <FavoriteButton
                        ch={ch}
                        isFav={favoriteIds.has(ch.id)}
                        onToggle={onToggleFavorite}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {offlineChannels.length > 0 && (
            <section>
              <h2 className="px-2.5 mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-white/40">
                Offline{" "}
                <span className="tabular ml-1 font-medium text-white/30">
                  {offlineChannels.length}
                </span>
              </h2>
              <ul className="space-y-0.5">
                {offlineVisible.map((ch) => {
                  const active = selectedChannelKey === `${ch.platform}:${ch.slug}`;
                  return (
                    <li
                      key={ch.id}
                      className={cn(
                        "group flex items-center rounded-xl pr-1 transition-colors",
                        active
                          ? "bg-white/[0.09] ring-1 ring-inset ring-white/[0.08]"
                          : "hover:bg-white/[0.04]",
                      )}
                    >
                      <button
                        onClick={() => onSelectChannel(ch)}
                        title={`Ver VODs e vídeos de ${ch.displayName}`}
                        className="min-w-0 flex-1 flex items-center gap-2.5 px-2.5 py-1.5 text-left"
                      >
                        <img
                          src={ch.avatarUrl}
                          alt=""
                          loading="lazy"
                          className={cn(
                            "h-7 w-7 shrink-0 rounded-full object-cover transition-opacity",
                            active
                              ? "opacity-100"
                              : "opacity-60 grayscale group-hover:opacity-90 group-hover:grayscale-0",
                          )}
                        />
                        <span
                          className={cn(
                            "min-w-0 flex-1 text-[13px] truncate transition-colors",
                            active
                              ? "font-medium text-white"
                              : "text-white/55 group-hover:text-white/85",
                          )}
                        >
                          {ch.displayName}
                        </span>
                        <PlatformBadge platform={ch.platform} size="xs" />
                      </button>
                      <FavoriteButton
                        ch={ch}
                        isFav={favoriteIds.has(ch.id)}
                        onToggle={onToggleFavorite}
                      />
                    </li>
                  );
                })}
              </ul>
              {offlineChannels.length > OFFLINE_PREVIEW && (
                <button
                  onClick={() => setShowAllOffline((v) => !v)}
                  className="mt-1 px-2.5 py-1.5 text-[12px] font-medium text-white/45 hover:text-white"
                >
                  {showAllOffline
                    ? "Mostrar menos"
                    : `Mostrar mais ${offlineChannels.length - OFFLINE_PREVIEW}`}
                </button>
              )}
            </section>
          )}
        </div>

        <div className="p-3 border-t border-white/[0.06] space-y-2">
          {!twitchConnected && (
            <button
              onClick={onOpenApiModal}
              className="press w-full flex items-center justify-center gap-2 rounded-full bg-[#9146FF] text-white py-2 text-[13px] font-semibold hover:brightness-110"
            >
              <UserRound className="h-3.5 w-3.5" />
              Conectar contas
            </button>
          )}
          <button
            onClick={onOpenChannelsModal}
            className="press w-full flex items-center justify-center gap-2 rounded-full bg-white/[0.07] text-white py-2 text-[13px] font-medium hover:bg-white/[0.12]"
          >
            <Plus className="h-3.5 w-3.5" />
            Gerenciar canais
          </button>
        </div>
      </div>
    </aside>
  );
}

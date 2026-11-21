"use client";

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Maximize2, Plus, X } from "lucide-react";
import type { FeedItem, LiveChannelStatus } from "@/types/streamex";
import { BENJI_SPRING, cn, EASE_OUT, formatViewerCount } from "@/lib/utils";
import { PlatformBadge } from "@/components/StreamexLogo";

export const MULTI_MAX = 4;

/** `startMuted` is decided once when the tile is added, so the iframe URL (and stream) never reloads. */
export type MultiItem = FeedItem & { startMuted: boolean };

interface MultiViewProps {
  items: MultiItem[];
  statuses: LiveChannelStatus[];
  candidates: FeedItem[];
  onAdd: (item: FeedItem) => void;
  onRemove: (id: string) => void;
  onBack: () => void;
}

function playerSrc(item: FeedItem, muted: boolean, host: string) {
  if (item.platform === "youtube") {
    return `https://www.youtube.com/embed/${encodeURIComponent(item.videoId || "")}?autoplay=1&mute=${muted ? 1 : 0}&playsinline=1`;
  }
  return item.platform === "twitch"
    ? `https://player.twitch.tv/?channel=${encodeURIComponent(item.channelSlug)}&parent=${host}&autoplay=true&muted=${muted}`
    : `https://player.kick.com/${encodeURIComponent(item.channelSlug)}?autoplay=true&muted=${muted}`;
}

function chatSrc(item: FeedItem, host: string) {
  if (item.platform === "youtube") {
    return `https://www.youtube.com/live_chat?v=${encodeURIComponent(item.videoId || "")}&embed_domain=${host}&dark_theme=1`;
  }
  return item.platform === "twitch"
    ? `https://www.twitch.tv/embed/${encodeURIComponent(item.channelSlug)}/chat?darkpopout&parent=${host}`
    : `https://kick.com/popout/${encodeURIComponent(item.channelSlug)}/chat`;
}

/**
 * Up to four lives side by side. Tiles keep a stable DOM order (re-ordering an iframe reloads
 * the stream), so "focus" only changes CSS order/span. Only the first stream starts with sound.
 */
export function MultiView({
  items,
  statuses,
  candidates,
  onAdd,
  onRemove,
  onBack,
}: MultiViewProps) {
  const [host] = useState(() =>
    typeof window !== "undefined" ? window.location.hostname || "localhost" : "localhost",
  );
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [pickerOpen]);

  const focused = items.find((i) => i.id === focusedId) ?? null;
  const chatItem = items.find((i) => i.id === chatId) ?? items[0] ?? null;
  const n = items.length;

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="press inline-flex items-center gap-1.5 rounded-full pl-2 pr-3.5 py-1.5 text-[14px] font-medium text-white/70 hover:bg-white/[0.06] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
          <h1 className="text-[17px] font-semibold tracking-[-0.015em] text-white">
            Multistream{" "}
            <span className="tabular font-normal text-white/35">
              {n}/{MULTI_MAX}
            </span>
          </h1>
        </div>

        <div ref={pickerRef} className="relative">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            disabled={n >= MULTI_MAX || candidates.length === 0}
            aria-expanded={pickerOpen}
            className="press inline-flex items-center gap-1.5 rounded-full bg-white text-black px-3.5 py-1.5 text-[13px] font-semibold hover:bg-white/90 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar live
          </button>
          <AnimatePresence>
            {pickerOpen && (
              <motion.div
                initial={{ opacity: 0, transform: "translateY(-4px) scale(0.95)" }}
                animate={{
                  opacity: 1,
                  transform: "translateY(0px) scale(1)",
                  transition: { duration: 0.18, ease: EASE_OUT },
                }}
                exit={{
                  opacity: 0,
                  transform: "translateY(-4px) scale(0.96)",
                  transition: { duration: 0.12, ease: EASE_OUT },
                }}
                className="absolute right-0 top-full z-30 mt-2 w-72 max-h-80 overflow-y-auto rounded-2xl liquid-glass-panel p-1.5"
                style={{ transformOrigin: "top right" }}
              >
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onAdd(c);
                      setPickerOpen(false);
                    }}
                    className="press w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07]"
                  >
                    <img
                      src={c.channelAvatar}
                      alt=""
                      className="h-7 w-7 rounded-full object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-white truncate">
                        {c.channelName}
                      </span>
                      <span className="block text-[12px] text-white/40 truncate">{c.category}</span>
                    </span>
                    <PlatformBadge platform={c.platform} size="xs" />
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {n === 0 ? (
        <div className="rounded-3xl bg-white/[0.03] px-6 py-16 text-center">
          <h2 className="text-[16px] font-semibold text-white">Nenhuma live no multistream</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-white/50">
            Passe o mouse numa live do feed e clique em{" "}
            <strong className="text-white/80">Multi</strong>, ou use “Adicionar live” acima. Dá para
            juntar Twitch e Kick, até {MULTI_MAX}.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 2xl:grid-cols-[1fr_340px] xl:grid-cols-[1fr_320px] gap-4 items-start">
          <div className={cn("grid gap-3", n === 1 ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2")}>
            {items.map((it) => {
              const isFocused = focused?.id === it.id;
              const span =
                n === 3 ? isFocused || (!focused && it.id === items[0].id) : isFocused && n > 1;
              const st = statuses.find(
                (s) => s.platform === it.platform && s.slug === it.channelSlug,
              );
              return (
                <div
                  key={it.id}
                  style={{ order: isFocused ? -1 : 0 }}
                  className={cn(
                    "group relative aspect-video overflow-hidden rounded-2xl bg-[#070708]",
                    span && "md:col-span-2",
                  )}
                >
                  <iframe
                    src={playerSrc(it, it.startMuted, host)}
                    className="h-full w-full border-0"
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                    title={`${it.channelName} ao vivo`}
                  />
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-2.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
                    <span className="flex min-w-0 items-center gap-2">
                      <PlatformBadge platform={it.platform} size="xs" />
                      <span className="truncate text-[13px] font-semibold text-white">
                        {it.channelName}
                      </span>
                      {st?.isLive ? (
                        <span className="tabular text-[12px] text-white/60">
                          {formatViewerCount(st.viewerCount)}
                        </span>
                      ) : st ? (
                        <span className="text-[12px] text-white/50">offline</span>
                      ) : null}
                    </span>
                    <span className="pointer-events-auto flex items-center gap-1">
                      {n > 1 && (
                        <button
                          onClick={() => setFocusedId(isFocused ? null : it.id)}
                          className="press flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 hover:text-white"
                          aria-label={
                            isFocused ? "Desfazer destaque" : `Destacar ${it.channelName}`
                          }
                          title={isFocused ? "Desfazer destaque" : "Destacar"}
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => onRemove(it.id)}
                        className="press flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 hover:text-white"
                        aria-label={`Tirar ${it.channelName} do multistream`}
                        title="Remover"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {chatItem && (
            <aside className="rounded-2xl bg-[#0c0c0e] border border-white/[0.06] overflow-hidden flex flex-col h-[520px] xl:h-[calc(100dvh-var(--chrome-h)-6rem)] xl:sticky xl:top-[calc(var(--chrome-h)+1rem)] transition-[top] duration-[260ms] ease-[var(--ease-out)]">
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar p-1.5 border-b border-white/[0.06]">
                {items.map((it) => {
                  const active = chatItem.id === it.id;
                  return (
                    <button
                      key={it.id}
                      onClick={() => setChatId(it.id)}
                      aria-pressed={active}
                      className={cn(
                        "relative shrink-0 flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-1 text-[12px] font-medium transition-colors",
                        active ? "text-white" : "text-white/50 hover:text-white",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="multi-chat-pill"
                          transition={BENJI_SPRING}
                          className="absolute inset-0 rounded-full bg-white/[0.12]"
                        />
                      )}
                      <img
                        src={it.channelAvatar}
                        alt=""
                        className="relative h-5 w-5 rounded-full object-cover"
                      />
                      <span className="relative max-w-[90px] truncate">{it.channelName}</span>
                    </button>
                  );
                })}
              </div>
              <iframe
                key={chatItem.id}
                src={chatSrc(chatItem, host)}
                className="flex-1 w-full border-0 bg-[#0c0c0e]"
                title={`Chat de ${chatItem.channelName}`}
              />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

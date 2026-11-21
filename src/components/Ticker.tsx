"use client";

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Globe2, TrendingUp } from "lucide-react";
import type { LiveChannelStatus } from "@/types/streamex";
import type { TickerNews, TickerQuote } from "@/app/api/ticker/route";
import { cn, formatViewerCount, PLATFORM_RING } from "@/lib/utils";

const CLOCKS: Array<{ label: string; tz: string }> = [
  { label: "Brasil", tz: "America/Sao_Paulo" },
  { label: "NY", tz: "America/New_York" },
  { label: "Chicago", tz: "America/Chicago" },
  { label: "LA", tz: "America/Los_Angeles" },
  { label: "Portugal", tz: "Europe/Lisbon" },
  { label: "Londres", tz: "Europe/London" },
  { label: "Paris", tz: "Europe/Paris" },
  { label: "Tóquio", tz: "Asia/Tokyo" },
];

/** Base reading speed in px/s (constant linear motion). */
const SPEED_PX_S = 44;
const DATA_REFRESH_MS = 60_000;

function formatPrice(q: TickerQuote) {
  if (q.kind === "fx")
    return `R$ ${q.price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (q.kind === "index")
    return q.currency === "BRL"
      ? `${Math.round(q.price).toLocaleString("pt-BR")} pts`
      : q.price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const digits = q.price >= 1000 ? 0 : 2;
  return `$${q.price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function Divider() {
  return <span aria-hidden className="mx-4 h-3 w-px shrink-0 bg-white/[0.12]" />;
}

let clockMinute = Math.floor(Date.now() / 30_000);
function subscribeClock(onChange: () => void) {
  const t = window.setInterval(() => {
    clockMinute = Math.floor(Date.now() / 30_000);
    onChange();
  }, 30_000);
  return () => window.clearInterval(t);
}
const getClientClock = () => clockMinute;
const getServerClock = () => null;

function useClockTick() {
  const tick = useSyncExternalStore(subscribeClock, getClientClock, getServerClock);
  return tick === null ? null : new Date(tick * 30_000);
}

/**
 * Desktop ticker under the header: smoothly glides through live channels, world clocks,
 * Wall Street / FX / crypto quotes, and Hacker News headlines.
 *
 * Driven by a single compositor-only `translate3d` rAF loop (zero React re-renders per frame)
 * so updating live viewer counts or arriving market quotes NEVER causes a CSS animation jump.
 * Hovering smoothly eases the belt to a stop so clicking any channel or headline feels effortless.
 */
export function Ticker({
  statuses,
  favoriteIds,
  onSelectChannel,
  paused = false,
}: {
  statuses: LiveChannelStatus[];
  favoriteIds: Set<string>;
  onSelectChannel: (ch: LiveChannelStatus) => void;
  paused?: boolean;
}) {
  const [quotes, setQuotes] = useState<TickerQuote[]>([]);
  const [news, setNews] = useState<TickerNews[]>([]);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const segRef = useRef<HTMLDivElement | null>(null);
  const hoveredRef = useRef(false);
  const pausedRef = useRef(paused);
  const now = useClockTick();

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      fetch("/api/ticker")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { quotes: TickerQuote[]; news: TickerNews[] } | null) => {
          if (!alive || !d) return;
          setQuotes(d.quotes);
          setNews(d.news);
        })
        .catch(() => undefined);
    };
    load();
    const t = window.setInterval(load, DATA_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  // Compositor-only continuous glide with smooth hover deceleration & zero width-change jumps.
  useEffect(() => {
    const track = trackRef.current;
    const seg = segRef.current;
    if (!track || !seg) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      track.style.transform = "";
      return;
    }

    let halfWidth = seg.offsetWidth || 1;
    const ro = new ResizeObserver(() => {
      const next = seg.offsetWidth;
      if (next > 0) halfWidth = next;
    });
    ro.observe(seg);

    let offset = 0;
    let velocity = SPEED_PX_S;
    let lastTs = performance.now();
    let rafId = 0;

    const step = (ts: number) => {
      const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
      lastTs = ts;

      if (!document.hidden && !pausedRef.current) {
        const target = hoveredRef.current ? 0 : SPEED_PX_S;
        // Exponential damping (~160ms) so hover eases to a velvet stop and accelerates back smoothly.
        const blend = 1 - Math.exp(-12 * dt);
        velocity += (target - velocity) * blend;
        if (Math.abs(velocity) < 0.15 && target === 0) velocity = 0;

        if (velocity > 0 && halfWidth > 0) {
          offset = (offset + velocity * dt) % halfWidth;
          track.style.transform = `translate3d(${-offset.toFixed(2)}px, 0, 0)`;
        }
      }

      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);

    const onMotionChange = () => {
      if (reducedMotion.matches) {
        window.cancelAnimationFrame(rafId);
        track.style.transform = "";
      }
    };
    reducedMotion.addEventListener("change", onMotionChange);

    return () => {
      window.cancelAnimationFrame(rafId);
      ro.disconnect();
      reducedMotion.removeEventListener("change", onMotionChange);
    };
  }, []);

  const live = [...statuses.filter((s) => s.isLive)].sort(
    (a, b) => Number(favoriteIds.has(b.id)) - Number(favoriteIds.has(a.id)),
  );

  const segment = (copy: boolean) => (
    <div
      ref={copy ? undefined : segRef}
      className="flex shrink-0 items-center pr-4"
      aria-hidden={copy || undefined}
    >
      {/* Live */}
      <span className="flex shrink-0 items-center gap-2 pr-3">
        <span className="live-dot h-2 w-2 rounded-full bg-[#53FC18]" />
        <span className="tabular text-[12px] font-semibold tracking-[-0.01em] text-white">
          {live.length} ao vivo
        </span>
      </span>
      {live.map((ch) => (
        <button
          key={`${copy ? "c" : "o"}-${ch.id}`}
          tabIndex={copy ? -1 : 0}
          onClick={() => onSelectChannel(ch)}
          className="press mr-1.5 flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.05] ring-1 ring-inset ring-white/[0.06] py-0.5 pl-0.5 pr-2.5 hover:bg-white/[0.1]"
        >
          <img
            src={ch.avatarUrl}
            alt=""
            className={cn(
              "h-5 w-5 rounded-full object-cover ring-[1.5px]",
              PLATFORM_RING[ch.platform],
            )}
          />
          <span className="max-w-[120px] truncate text-[12px] font-medium text-white">
            {ch.displayName}
          </span>
          <span className="tabular text-[11px] text-white/45">
            {formatViewerCount(ch.viewerCount)}
          </span>
        </button>
      ))}

      <Divider />

      {/* World Clocks */}
      <span className="mr-2.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
        <Globe2 className="h-3 w-3 text-white/55" aria-hidden />
        Mundo
      </span>
      {CLOCKS.map((c, i) => (
        <span key={c.tz} className="flex shrink-0 items-baseline gap-1.5 text-[12px]">
          {i > 0 && <span className="mx-2 text-white/15">·</span>}
          <span className="text-white/45">{c.label}</span>
          <span className="tabular font-medium text-white/95" suppressHydrationWarning>
            {now
              ? now.toLocaleTimeString("pt-BR", {
                  timeZone: c.tz,
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "--:--"}
          </span>
        </span>
      ))}

      {quotes.length > 0 && (
        <>
          <Divider />
          <span className="mr-2.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
            <TrendingUp className="h-3 w-3 text-white/55" aria-hidden />
            Mercado
          </span>
        </>
      )}

      {/* Markets */}
      {quotes.map((q) => {
        const up = q.changePct >= 0;
        return (
          <span key={q.symbol} className="mr-4 flex shrink-0 items-center gap-1.5 text-[12px]">
            <span className="font-semibold text-white/90">{q.label}</span>
            <span className="tabular text-white/65">{formatPrice(q)}</span>
            <span
              className={cn(
                "tabular rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                up ? "bg-[#30D158]/12 text-[#30D158]" : "bg-[#FF453A]/12 text-[#FF453A]",
              )}
            >
              {up ? "▲" : "▼"} {Math.abs(q.changePct).toFixed(2)}%
            </span>
          </span>
        );
      })}

      {news.length > 0 && <Divider />}

      {/* Hacker News */}
      {news.map((n, i) => (
        <span key={n.url + i} className="flex shrink-0 items-center text-[12px]">
          {i === 0 && (
            <span className="mr-2.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#FF6600]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#FF8533]">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] bg-[#FF6600] text-[9px] font-extrabold text-white">
                Y
              </span>
              HN
            </span>
          )}
          {i > 0 && <span className="mx-3 text-white/15">·</span>}
          <a
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={copy ? -1 : 0}
            className="max-w-[420px] truncate text-white/70 transition-colors hover:text-white"
          >
            {n.title}
          </a>
        </span>
      ))}
    </div>
  );

  return (
    <div
      className="ticker edge-fade relative h-10 overflow-hidden"
      aria-label="Ao vivo, horários, mercado e notícias"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") hoveredRef.current = true;
      }}
      onPointerLeave={() => {
        hoveredRef.current = false;
      }}
      onFocus={() => {
        hoveredRef.current = true;
      }}
      onBlur={() => {
        hoveredRef.current = false;
      }}
    >
      <div
        ref={trackRef}
        className="ticker-track flex h-full w-max items-center pl-4 will-change-transform"
      >
        {segment(false)}
        {segment(true)}
      </div>
    </div>
  );
}

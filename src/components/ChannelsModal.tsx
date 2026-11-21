"use client";

import React, { useMemo, useState } from "react";
import { Loader2, Plus, Search, Star, Users, X } from "lucide-react";
import type { ApiCredentials, FollowedChannel, Platform } from "@/types/streamex";
import { cn, makeAvatarFallback, PLATFORM_LABEL } from "@/lib/utils";
import { buildCredentialHeaders } from "@/lib/storage";
import { PlatformBadge } from "@/components/StreamexLogo";
import { Modal } from "@/components/Modal";

interface ChannelsModalProps {
  open: boolean;
  channels: FollowedChannel[];
  credentials: ApiCredentials;
  onClose: () => void;
  onUpdateChannels: (next: FollowedChannel[]) => void;
}

export function ChannelsModal({
  open,
  channels,
  credentials,
  onClose,
  onUpdateChannels,
}: ChannelsModalProps) {
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);

  const [notFound, setNotFound] = useState<string[]>([]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawEntries = input
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (rawEntries.length === 0) return;

    setAdding(true);
    setNotFound([]);
    const missing: string[] = [];
    try {
      const added: FollowedChannel[] = [];
      for (const raw of rawEntries) {
        const lower = raw.toLowerCase();
        const detectedPlatform: Platform = lower.includes("kick.com")
          ? "kick"
          : lower.includes("twitch.tv")
            ? "twitch"
            : lower.includes("youtube.com") || lower.includes("youtu.be")
              ? "youtube"
              : platform;

        // Twitch/Kick: the slug is the lowercase login. YouTube: keep the input as typed; the
        // server resolves it (@handle, URL or UC… id) to the channel's stable id.
        let slug =
          detectedPlatform === "youtube"
            ? raw
            : raw
                .replace(/^https?:\/\/(www\.)?(twitch\.tv|kick\.com)\//i, "")
                .replace(/^@/, "")
                .split(/[/?#]/)[0]
                .toLowerCase();
        if (!slug) continue;

        if (detectedPlatform !== "youtube") {
          const id = `${detectedPlatform}:${slug}`;
          if (channels.some((c) => c.id === id) || added.some((c) => c.id === id)) continue;
        }

        let displayName = slug;
        let avatarUrl = makeAvatarFallback(slug, detectedPlatform);
        let resolved = false;
        try {
          const res = await fetch("/api/channel-lookup", {
            method: "POST",
            headers: buildCredentialHeaders(credentials),
            body: JSON.stringify({ platform: detectedPlatform, query: slug }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              slug?: string;
              displayName?: string;
              avatarUrl?: string;
            };
            slug = data.slug || slug;
            displayName = data.displayName || displayName;
            avatarUrl = data.avatarUrl || avatarUrl;
            resolved = Boolean(data.slug);
          }
        } catch {
          // keep fallback
        }

        // A YouTube channel we couldn't resolve has no usable id — tell the user instead of adding junk.
        if (detectedPlatform === "youtube" && !resolved) {
          missing.push(raw);
          continue;
        }
        const id = `${detectedPlatform}:${slug}`;
        if (channels.some((c) => c.id === id) || added.some((c) => c.id === id)) continue;

        added.push({
          id,
          platform: detectedPlatform,
          slug,
          displayName,
          avatarUrl,
          addedAt: Date.now(),
          source: "manual",
        });
      }
      if (added.length > 0) onUpdateChannels([...added, ...channels]);
      setNotFound(missing);
      setInput(missing.join(", "));
    } finally {
      setAdding(false);
    }
  };

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? channels.filter((c) => `${c.displayName} ${c.slug}`.toLowerCase().includes(q))
      : channels;
    return [...list].sort(
      (a, b) =>
        Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
        a.displayName.localeCompare(b.displayName),
    );
  }, [channels, filter]);

  const count = (p: Platform) => channels.filter((c) => c.platform === p).length;
  const subtitle = [
    `${count("twitch")} na Twitch`,
    `${count("kick")} na Kick`,
    count("youtube") > 0 ? `${count("youtube")} no YouTube` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const platforms = ["twitch", "kick", "youtube"] as const;
  const segIndex = platforms.indexOf(platform as (typeof platforms)[number]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Canais"
      subtitle={subtitle}
      icon={<Users className="h-4 w-4" />}
      className="sm:max-w-xl"
    >
      <form onSubmit={handleAdd} className="px-5 sm:px-6 pb-4 space-y-2.5">
        {/* Segmented control */}
        <div className="relative grid grid-cols-3 rounded-full bg-white/[0.05] p-1">
          {/* Sliding thumb: moves by its own width (translateX %), colored per platform */}
          <span
            aria-hidden
            style={{ transform: `translateX(${segIndex * 100}%)` }}
            className={cn(
              "absolute inset-y-1 left-1 w-[calc((100%-8px)/3)] rounded-full transition-[transform,background-color] duration-200",
              platform === "kick"
                ? "bg-[#53FC18]"
                : platform === "youtube"
                  ? "bg-[#FF0033]"
                  : "bg-[#9146FF]",
            )}
          />
          {platforms.map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => setPlatform(p)}
              aria-pressed={platform === p}
              className={cn(
                "relative z-10 rounded-full py-1.5 text-[13px] font-semibold transition-colors",
                platform === p ? (p === "kick" ? "text-black" : "text-white") : "text-white/55",
              )}
            >
              {PLATFORM_LABEL[p]}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              platform === "kick"
                ? "xqc, westcol, kick.com/…"
                : platform === "youtube"
                  ? "@canal ou youtube.com/@canal"
                  : "gaules, alanzoka, twitch.tv/…"
            }
            className="min-w-0 flex-1 rounded-full border border-white/[0.1] bg-black/50 px-4 py-2.5 text-[16px] sm:text-[13px] text-white placeholder:text-white/30 focus:border-white/35 focus:outline-none"
          />
          <button
            type="submit"
            disabled={adding || !input.trim()}
            className="press shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white text-black px-4 py-2.5 text-[13px] font-semibold hover:bg-white/90 disabled:opacity-40"
          >
            {adding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Adicionar
          </button>
        </div>
        {notFound.length > 0 ? (
          <p className="px-1 text-[12px] text-[#FF8A9B]">
            Não achei no YouTube: {notFound.join(", ")}. Confira o @ ou cole o link do canal.
          </p>
        ) : (
          <p className="px-1 text-[12px] text-white/40">
            Cole vários separados por vírgula, espaço ou linha — ou a URL do canal.
          </p>
        )}
      </form>

      <div className="border-t border-white/[0.06]">
        {channels.length > 8 && (
          <div className="px-5 sm:px-6 pt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Filtrar ${channels.length} canais`}
                className="w-full rounded-full bg-white/[0.05] pl-9 pr-4 py-2 text-[16px] sm:text-[13px] text-white placeholder:text-white/35 focus:outline-none focus:bg-white/[0.08]"
              />
            </div>
          </div>
        )}

        <ul className="px-3 sm:px-4 py-2 max-h-[46dvh] overflow-y-auto overscroll-contain">
          {visible.map((ch) => (
            <li
              key={ch.id}
              className="group flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-white/[0.04]"
            >
              <img
                src={ch.avatarUrl || makeAvatarFallback(ch.slug, ch.platform)}
                alt=""
                loading="lazy"
                className="h-8 w-8 shrink-0 rounded-full object-cover bg-white/5"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-white truncate">{ch.displayName}</div>
                <div className="text-[12px] text-white/40 truncate">
                  {ch.platform === "youtube" ? "canal do YouTube" : `@${ch.slug}`}
                  {ch.source === "twitch-follow" && " · seguido na Twitch"}
                </div>
              </div>
              <PlatformBadge platform={ch.platform} size="xs" />
              <button
                onClick={() =>
                  onUpdateChannels(
                    channels.map((c) => (c.id === ch.id ? { ...c, favorite: !c.favorite } : c)),
                  )
                }
                aria-pressed={Boolean(ch.favorite)}
                aria-label={
                  ch.favorite
                    ? `Tirar ${ch.displayName} dos favoritos`
                    : `Favoritar ${ch.displayName}`
                }
                className={cn(
                  "press shrink-0 flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/[0.08]",
                  ch.favorite ? "text-[#FFD60A]" : "text-white/30 hover:text-white",
                )}
              >
                <Star
                  key={String(Boolean(ch.favorite))}
                  className={cn("h-3.5 w-3.5", ch.favorite && "pop fill-current")}
                />
              </button>
              <button
                onClick={() => onUpdateChannels(channels.filter((c) => c.id !== ch.id))}
                className="press shrink-0 flex h-8 w-8 items-center justify-center rounded-full text-white/35 hover:bg-red-500/15 hover:text-red-400"
                aria-label={`Remover ${ch.displayName}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="py-8 text-center text-[13px] text-white/40">Nenhum canal encontrado.</li>
          )}
        </ul>
      </div>

      <div className="flex justify-end border-t border-white/[0.06] px-5 sm:px-6 py-3.5">
        <button
          onClick={onClose}
          className="press rounded-full bg-white/[0.08] hover:bg-white/[0.14] px-5 py-2 text-[13px] font-semibold text-white"
        >
          Concluir
        </button>
      </div>
    </Modal>
  );
}

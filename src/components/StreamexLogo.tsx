"use client";

import React from "react";
import { cn } from "@/lib/utils";

export function StreamexLogo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <svg
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("h-8 w-8", className)}
        aria-label="STREAMEX"
      >
        <rect
          x="1"
          y="1"
          width="34"
          height="34"
          rx="9"
          fill="#09090B"
          stroke="rgba(83,252,24,0.45)"
          strokeWidth="1.5"
        />
        {/* Kick-inspired stepped blocky X */}
        <path
          d="M8 8H15V12H17V15H19V12H21V8H28V14H24V16H22V20H24V22H28V28H21V24H19V21H17V24H15V28H8V22H12V20H14V16H12V14H8V8Z"
          fill="#53FC18"
        />
      </svg>
    );
  }

  return (
    <div className={cn("inline-flex items-center gap-2 select-none group", className)}>
      {/* Kick-inspired stepped blocky wordmark */}
      <svg
        viewBox="0 0 218 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-[18px] sm:h-5 w-auto"
        aria-label="STREAMEX"
      >
        {/* S */}
        <path d="M2 4H24V10H9V13H24V28H2V22H17V19H2V4Z" fill="#FFFFFF" />
        {/* T */}
        <path d="M28 4H52V10H43.5V28H36.5V10H28V4Z" fill="#FFFFFF" />
        {/* R */}
        <path
          d="M56 4H79V15H74V18H79V28H71.5V20H63.5V28H56V4ZM63.5 10V14H71.5V10H63.5Z"
          fill="#FFFFFF"
        />
        {/* E */}
        <path d="M84 4H106V10H91.5V13.5H103V18.5H91.5V22H106V28H84V4Z" fill="#FFFFFF" />
        {/* A */}
        <path
          d="M110 4H133V28H125.5V20H117.5V28H110V4ZM117.5 10V14.5H125.5V10H117.5Z"
          fill="#FFFFFF"
        />
        {/* M */}
        <path
          d="M138 4H146V9H150V13H153V9H157V4H165V28H157.5V16H154V20H149V16H145.5V28H138V4Z"
          fill="#FFFFFF"
        />
        {/* E */}
        <path d="M170 4H190V10H177V13.5H187.5V18.5H177V22H190V28H170V4Z" fill="#FFFFFF" />
        {/* X — Iconic Kick Neon Green blocky stepped mark */}
        <path
          d="M194 4H202V9H204.5V12H206.5V9H209V4H217V11H213V14H210.5V18H213V21H217V28H209V23H206.5V20H204.5V23H202V28H194V21H198V18H200.5V14H198V11H194V4Z"
          fill="#53FC18"
        />
      </svg>
    </div>
  );
}

export function PlatformBadge({
  platform,
  size = "sm",
  showLabel = false,
}: {
  platform: "twitch" | "kick" | "youtube";
  size?: "xs" | "sm" | "md";
  showLabel?: boolean;
}) {
  const iconSize = size === "xs" ? "h-3 w-3" : size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";

  if (platform === "youtube") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full font-mono font-bold uppercase tracking-wider",
          showLabel
            ? "px-2 py-0.5 text-[10px] bg-[#FF0033]/15 text-[#FF4D6A] border border-[#FF0033]/35"
            : "p-1 bg-[#FF0033]/15 text-[#FF4D6A] border border-[#FF0033]/30",
        )}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className={iconSize} aria-hidden="true">
          <path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.75 15.02V8.98L15.5 12l-5.75 3.02z" />
        </svg>
        {showLabel && <span>YouTube</span>}
      </span>
    );
  }

  if (platform === "kick") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full font-mono font-bold uppercase tracking-wider",
          showLabel
            ? "px-2 py-0.5 text-[10px] bg-[#53FC18]/15 text-[#53FC18] border border-[#53FC18]/35"
            : "p-1 bg-[#53FC18]/15 text-[#53FC18] border border-[#53FC18]/30",
        )}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className={iconSize} aria-hidden="true">
          <path d="M4 3h6v6h3V6h3V3h5v6h-3v3h-3v1h3v3h3v5h-5v-3h-3v-3h-3v6H4V3z" />
        </svg>
        {showLabel && <span>Kick</span>}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-mono font-bold uppercase tracking-wider",
        showLabel
          ? "px-2 py-0.5 text-[10px] bg-[#9146FF]/20 text-[#BF94FF] border border-[#9146FF]/40"
          : "p-1 bg-[#9146FF]/20 text-[#BF94FF] border border-[#9146FF]/35",
      )}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className={iconSize} aria-hidden="true">
        <path d="M4.265 3L3 6.236v13.223h4.502V21l2.531.085L12.564 19.46h3.658L21 14.68V3H4.265zm15.048 10.835l-2.813 2.813h-4.502l-2.39 2.39v-2.39H5.813V4.688h13.5v9.147zM15.656 7.5h1.688v4.781h-1.688V7.5zm-4.5 0h1.688v4.781h-1.688V7.5z" />
      </svg>
      {showLabel && <span>Twitch</span>}
    </span>
  );
}

(() => {
  const HOST = window.location.hostname.toLowerCase();
  const PLATFORM = HOST.includes("kick.com") ? "kick" : "twitch";

  let lastUrl = window.location.href;
  let resumedKeys = new Set();
  let hudEl = null;
  let hudTimeout = null;

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
    return `${m}:${String(rem).padStart(2, "0")}`;
  }

  function showHud(text) {
    if (!hudEl) {
      hudEl = document.createElement("div");
      hudEl.id = "streamex-sync-hud";
      Object.assign(hudEl.style, {
        position: "fixed",
        bottom: "18px",
        right: "18px",
        zIndex: "999999",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 14px",
        borderRadius: "9999px",
        background: "rgba(9, 9, 12, 0.86)",
        backdropFilter: "blur(20px) saturate(180%)",
        border: "1px solid rgba(83, 252, 24, 0.42)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.6), 0 0 22px rgba(83,252,24,0.18)",
        color: "#ffffff",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "11px",
        fontWeight: "700",
        pointerEvents: "none",
        opacity: "0",
        transform: "translateY(8px)",
        transition: "opacity 220ms ease, transform 220ms cubic-bezier(0.22,1,0.36,1)",
      });
      document.body.appendChild(hudEl);
    }

    hudEl.innerHTML = `<span style="width:7px;height:7px;border-radius:999px;background:#53FC18;box-shadow:0 0 10px #53FC18;display:inline-block;"></span><span>${text}</span>`;
    hudEl.style.opacity = "1";
    hudEl.style.transform = "translateY(0)";

    if (hudTimeout) clearTimeout(hudTimeout);
    hudTimeout = setTimeout(() => {
      if (hudEl) {
        hudEl.style.opacity = "0";
        hudEl.style.transform = "translateY(8px)";
      }
    }, 2800);
  }

  function parsePageContext() {
    const path = window.location.pathname.replace(/\/+$/, "");
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return null;

    const cleanTitle = (document.title || "")
      .replace(/\s*[-|]\s*(Twitch|Kick).*$/i, "")
      .trim();

    if (PLATFORM === "twitch") {
      // /videos/123456789
      if (parts[0] === "videos" && parts[1]) {
        const videoId = parts[1];
        const channelEl = document.querySelector('a[data-a-target="user-channel-header-item"], h1.tw-title');
        const channelSlug = (channelEl?.textContent || "twitch").trim().toLowerCase().replace(/\s+/g, "");
        return {
          key: `twitch:vod:${videoId}`,
          platform: "twitch",
          contentType: "vod",
          videoId,
          channelSlug,
          channelName: channelEl?.textContent?.trim() || channelSlug,
          title: cleanTitle || `Twitch VOD #${videoId}`,
        };
      }
      // /channel/clip/...
      if (parts.includes("clip")) return null;
      // Ignore utility routes
      const ignored = new Set(["directory", "settings", "subscriptions", "inventory", "wallet", "search", "downloads"]);
      if (ignored.has(parts[0].toLowerCase())) return null;

      const slug = parts[0].toLowerCase();
      return {
        key: `twitch:live:${slug}`,
        platform: "twitch",
        contentType: "live",
        channelSlug: slug,
        channelName: slug,
        title: cleanTitle || `Live de ${slug}`,
      };
    }

    // Kick
    if (parts[1] === "videos" && parts[2]) {
      const slug = parts[0].toLowerCase();
      const videoId = parts[2];
      return {
        key: `kick:vod:${videoId}`,
        platform: "kick",
        contentType: "vod",
        videoId,
        channelSlug: slug,
        channelName: slug,
        title: cleanTitle || `Kick VOD de ${slug}`,
      };
    }

    const ignoredKick = new Set(["browse", "categories", "following", "transactions", "settings", "dashboard"]);
    if (ignoredKick.has(parts[0].toLowerCase())) return null;

    const slug = parts[0].toLowerCase();
    return {
      key: `kick:live:${slug}`,
      platform: "kick",
      contentType: "live",
      channelSlug: slug,
      channelName: slug,
      title: cleanTitle || `Live de ${slug}`,
    };
  }

  function findMainVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) return null;
    return videos.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  }

  async function tryAutoResume(ctx, video) {
    if (!ctx || ctx.contentType !== "vod" || resumedKeys.has(ctx.key)) return;
    if (!video || !Number.isFinite(video.duration) || video.duration < 30) return;

    resumedKeys.add(ctx.key);
    try {
      const resp = await chrome.runtime.sendMessage({ type: "GET_PROGRESS_MAP" });
      const saved = resp?.progressMap?.[ctx.key];
      if (!saved || !saved.currentTime) return;

      const target = Math.floor(saved.currentTime);
      if (target > 8 && target < video.duration - 15 && Math.abs(video.currentTime - target) > 6) {
        video.currentTime = target;
        showHud(`STREAMEX • Retomado em ${formatTime(target)}`);
      }
    } catch {
      // Ignore messaging error
    }
  }

  async function captureProgress(silent = true) {
    const ctx = parsePageContext();
    // Only VODs have a timeline to come back to; a live's currentTime is just session time.
    if (!ctx || ctx.contentType !== "vod") return;
    const video = findMainVideo();
    if (!video) return;

    await tryAutoResume(ctx, video);

    const currentTime = Math.floor(video.currentTime || 0);
    const duration = Number.isFinite(video.duration) ? Math.floor(video.duration) : 0;
    if (currentTime < 10) return;

    const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";

    const entry = {
      key: ctx.key,
      platform: ctx.platform,
      channelSlug: ctx.channelSlug,
      channelName: ctx.channelName,
      contentType: ctx.contentType,
      videoId: ctx.videoId,
      title: ctx.title,
      thumbnailUrl: ogImg,
      currentTime,
      duration,
      updatedAt: Date.now(),
      url: window.location.href,
      source: "extension",
    };

    try {
      await chrome.runtime.sendMessage({ type: "SAVE_PROGRESS_ENTRY", entry });
      if (!silent) {
        showHud(`STREAMEX • Salvo em ${formatTime(currentTime)}`);
      }
    } catch {
      // Ignore if extension reloaded
    }
  }

  // Periodic tracker every 3s
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
    }
    captureProgress(true);
  }, 3000);

  // Save immediately when pausing or leaving tab
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") captureProgress(true);
  });

  window.addEventListener("beforeunload", () => {
    captureProgress(true);
  });

  document.addEventListener(
    "pause",
    (e) => {
      if (e.target && e.target.tagName === "VIDEO") {
        captureProgress(false);
      }
    },
    true
  );
})();

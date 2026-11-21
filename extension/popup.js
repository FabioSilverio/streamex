const STORAGE_KEY = "streamex_progress_map";

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

function buildResumeUrl(item) {
  const t = Math.max(0, Math.floor(item.currentTime || 0));
  if (item.platform === "twitch" && item.contentType === "vod" && item.videoId) {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return `https://www.twitch.tv/videos/${item.videoId}?t=${h}h${m}m${s}s`;
  }
  return item.url || (item.platform === "kick"
    ? `https://kick.com/${item.channelSlug}`
    : `https://www.twitch.tv/${item.channelSlug}`);
}

async function render() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const map = data[STORAGE_KEY] || {};
  const entries = Object.values(map)
    .filter((e) => e.contentType === "vod" && (e.currentTime || 0) >= 10)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  const countEl = document.getElementById("count");

  countEl.textContent = String(entries.length);
  listEl.innerHTML = "";

  if (entries.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  for (const item of entries) {
    const pct = item.duration > 0 ? Math.min(100, Math.round((item.currentTime / item.duration) * 100)) : 40;
    const card = document.createElement("div");
    card.className = "item";
    card.innerHTML = `
      <div class="item-top">
        <span class="platform-pill ${item.platform === "kick" ? "platform-kick" : "platform-twitch"}">
          ${item.platform} • ${item.contentType || "live"}
        </span>
        <span class="time-chip">${formatTime(item.currentTime)}${item.duration > 0 ? ` / ${formatTime(item.duration)}` : ""}</span>
      </div>
      <div class="title" title="${item.title || ""}">${item.title || item.channelName}</div>
      <div class="meta">
        <span>${item.channelName || item.channelSlug}</span>
      </div>
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="actions">
        <button class="btn-resume">Retomar em ${formatTime(item.currentTime)}</button>
        <button class="btn-del">✕</button>
      </div>
    `;

    card.querySelector(".btn-resume").addEventListener("click", () => {
      chrome.tabs.create({ url: buildResumeUrl(item) });
    });

    card.querySelector(".btn-del").addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "DELETE_PROGRESS_ENTRY", key: item.key });
      render();
    });

    listEl.appendChild(card);
  }
}

document.getElementById("clear-btn").addEventListener("click", async () => {
  await chrome.storage.local.set({ [STORAGE_KEY]: {} });
  render();
});

render();

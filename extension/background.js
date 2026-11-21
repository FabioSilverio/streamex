const STORAGE_KEY = "streamex_progress_map";
const MAX_ENTRIES = 120;

async function getProgressMap() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}

async function saveEntry(entry) {
  if (!entry || !entry.key) return {};
  // Lives can't be resumed; only keep them if they carry user-made bookmarks.
  if (entry.contentType !== "vod" && !(Array.isArray(entry.bookmarks) && entry.bookmarks.length)) {
    return getProgressMap();
  }
  const map = await getProgressMap();
  const prev = map[entry.key];

  // Keep latest timestamp & preserve bookmarks
  map[entry.key] = {
    ...(prev || {}),
    ...entry,
    bookmarks:
      Array.isArray(entry.bookmarks) && entry.bookmarks.length > 0
        ? entry.bookmarks
        : prev?.bookmarks || [],
    updatedAt: entry.updatedAt || Date.now(),
  };

  // Prune oldest entries if exceeding cap
  const entries = Object.entries(map).sort(
    (a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)
  );
  const trimmed = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
  await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
  return trimmed;
}

async function deleteEntry(key) {
  const map = await getProgressMap();
  delete map[key];
  await chrome.storage.local.set({ [STORAGE_KEY]: map });
  return map;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "GET_PROGRESS_MAP") {
    getProgressMap().then((progressMap) => sendResponse({ ok: true, progressMap }));
    return true;
  }

  if (msg.type === "SAVE_PROGRESS_ENTRY") {
    saveEntry(msg.entry).then((progressMap) => sendResponse({ ok: true, progressMap }));
    return true;
  }

  if (msg.type === "DELETE_PROGRESS_ENTRY") {
    deleteEntry(msg.key).then((progressMap) => sendResponse({ ok: true, progressMap }));
    return true;
  }
});

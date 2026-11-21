(() => {
  const STORAGE_KEY = "streamex_progress_map";
  const KICK_FOLLOWS_KEY = "streamex_kick_follows";

  async function pushKickFollows() {
    try {
      const data = await chrome.storage.local.get(KICK_FOLLOWS_KEY);
      const payload = data[KICK_FOLLOWS_KEY];
      if (payload && Array.isArray(payload.channels) && payload.channels.length) {
        window.postMessage({ type: "STREAMEX_EXT_KICK_FOLLOWS", ...payload }, "*");
      }
    } catch {
      // Ignore
    }
  }

  async function pushMapToWeb(type = "STREAMEX_EXT_SYNC") {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "GET_PROGRESS_MAP" });
      window.postMessage(
        {
          type,
          progressMap: resp?.progressMap || {},
        },
        "*"
      );
    } catch {
      // Ignore
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || typeof event.data !== "object") return;
    const msg = event.data;

    if (msg.type === "STREAMEX_WEB_PING") {
      pushMapToWeb("STREAMEX_EXT_PONG");
      pushKickFollows();
    } else if (msg.type === "STREAMEX_WEB_SAVE_PROGRESS" && msg.entry) {
      chrome.runtime
        .sendMessage({ type: "SAVE_PROGRESS_ENTRY", entry: msg.entry })
        .catch(() => {});
    } else if (msg.type === "STREAMEX_WEB_DELETE_PROGRESS" && msg.key) {
      chrome.runtime
        .sendMessage({ type: "DELETE_PROGRESS_ENTRY", key: msg.key })
        .catch(() => {});
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KICK_FOLLOWS_KEY]) pushKickFollows();
    if (area === "local" && changes[STORAGE_KEY]) {
      window.postMessage(
        {
          type: "STREAMEX_EXT_SYNC",
          progressMap: changes[STORAGE_KEY].newValue || {},
        },
        "*"
      );
    }
  });

  // Announce presence right away
  pushMapToWeb("STREAMEX_EXT_PONG");
  pushKickFollows();
})();

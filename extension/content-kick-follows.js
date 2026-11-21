// Runs on kick.com. Kick's public API has no "followed channels" endpoint, but the site's own
// API does, using the session you're already logged in with. Read it and hand it to Streamex.
(() => {
  const STORE = "streamex_kick_follows";
  const REFRESH_MS = 30 * 60 * 1000;

  function sessionToken() {
    const m = document.cookie.match(/(?:^|;\s*)session_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function fetchPage(cursor) {
    const url = `/api/v2/channels/followed?cursor=${encodeURIComponent(cursor)}`;
    const base = { credentials: "include", headers: { Accept: "application/json" } };
    let res = await fetch(url, base);
    if (res.status === 401 || res.status === 403) {
      const token = sessionToken();
      if (!token) return null;
      res = await fetch(url, {
        ...base,
        headers: { ...base.headers, Authorization: `Bearer ${token}` },
      });
    }
    if (!res.ok) return null;
    return res.json();
  }

  async function sync() {
    const { [STORE]: prev } = await chrome.storage.local.get(STORE);
    if (prev && Date.now() - (prev.syncedAt || 0) < REFRESH_MS) return;

    const channels = [];
    let cursor = 0;
    for (let page = 0; page < 20; page++) {
      const data = await fetchPage(cursor).catch(() => null);
      if (!data) break;
      const list = Array.isArray(data.channels) ? data.channels : Array.isArray(data) ? data : [];
      for (const c of list) {
        const slug = String(c.channel_slug || c.slug || c.user?.username || "").toLowerCase();
        if (!slug) continue;
        channels.push({
          slug,
          displayName: c.user_username || c.username || c.user?.username || slug,
          avatarUrl: c.profile_picture || c.user?.profile_pic || "",
        });
      }
      const next = data.nextCursor ?? data.next_cursor ?? null;
      if (next === null || next === undefined || list.length === 0 || next === cursor) break;
      cursor = next;
    }

    if (channels.length > 0) {
      await chrome.storage.local.set({ [STORE]: { channels, syncedAt: Date.now() } });
    }
  }

  sync();
})();

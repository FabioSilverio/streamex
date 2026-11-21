import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { AuthPlatform as Platform, FollowedChannel } from "@/types/streamex";

export interface StoredAccount {
  platform: Platform;
  userId: string;
  login: string;
  displayName: string;
  avatarUrl: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface PublicAccount {
  platform: Platform;
  userId: string;
  login: string;
  displayName: string;
  avatarUrl: string;
}

const COOKIE: Record<Platform, string> = {
  twitch: "sx_twitch_account",
  kick: "sx_kick_account",
};
const STATE_COOKIE = "sx_oauth_state";
const ACCOUNT_MAX_AGE = 60 * 60 * 24 * 60; // 60 days; refresh tokens keep it alive

export const TWITCH_SCOPES = ["user:read:follows"];
export const KICK_SCOPES = ["user:read", "channel:read"];

export function serverCreds(platform: Platform) {
  const id =
    platform === "twitch"
      ? process.env.TWITCH_CLIENT_ID?.trim()
      : process.env.KICK_CLIENT_ID?.trim();
  const secret =
    platform === "twitch"
      ? process.env.TWITCH_CLIENT_SECRET?.trim()
      : process.env.KICK_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

export function redirectUri(req: NextRequest, platform: Platform) {
  // Both apps are registered with the site root as their redirect URL (Kick only allows one).
  // The root's `?code&state` is routed to the right callback by src/proxy.ts.
  const override =
    platform === "kick" ? process.env.KICK_REDIRECT_URI : process.env.TWITCH_REDIRECT_URI;
  return override?.trim() || req.nextUrl.origin;
}

const cookieBase = (req: NextRequest) => ({
  httpOnly: true,
  secure: req.nextUrl.protocol === "https:",
  sameSite: "lax" as const,
  path: "/",
});

export function readAccount(req: NextRequest, platform: Platform): StoredAccount | null {
  const raw = req.cookies.get(COOKIE[platform])?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as StoredAccount;
    return parsed.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

export function writeAccount(req: NextRequest, res: NextResponse, account: StoredAccount) {
  res.cookies.set(
    COOKIE[account.platform],
    Buffer.from(JSON.stringify(account), "utf8").toString("base64url"),
    { ...cookieBase(req), maxAge: ACCOUNT_MAX_AGE },
  );
}

export function clearAccount(req: NextRequest, res: NextResponse, platform: Platform) {
  res.cookies.set(COOKIE[platform], "", { ...cookieBase(req), maxAge: 0 });
}

export function toPublic(a: StoredAccount | null): PublicAccount | null {
  if (!a) return null;
  return {
    platform: a.platform,
    userId: a.userId,
    login: a.login,
    displayName: a.displayName,
    avatarUrl: a.avatarUrl,
  };
}

// ---------- state + PKCE ----------

interface OAuthState {
  platform: Platform;
  state: string;
  verifier?: string;
}

export function makeState(platform: Platform, withPkce: boolean) {
  const state = randomBytes(16).toString("base64url");
  const verifier = withPkce ? randomBytes(48).toString("base64url") : undefined;
  const challenge = verifier
    ? createHash("sha256").update(verifier).digest("base64url")
    : undefined;
  return { payload: { platform, state, verifier } satisfies OAuthState, challenge };
}

export function writeState(req: NextRequest, res: NextResponse, payload: OAuthState) {
  res.cookies.set(STATE_COOKIE, Buffer.from(JSON.stringify(payload)).toString("base64url"), {
    ...cookieBase(req),
    maxAge: 600,
  });
}

export function consumeState(
  req: NextRequest,
  res: NextResponse,
  platform: Platform,
  state: string | null,
) {
  const raw = req.cookies.get(STATE_COOKIE)?.value;
  res.cookies.set(STATE_COOKIE, "", { ...cookieBase(req), maxAge: 0 });
  if (!raw || !state) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as OAuthState;
    return parsed.platform === platform && parsed.state === state ? parsed : null;
  } catch {
    return null;
  }
}

// ---------- token exchange / refresh ----------

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function postToken(url: string, body: Record<string, string>): Promise<TokenResponse | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = (await res.json().catch(() => null)) as TokenResponse | null;
  return data?.access_token ? data : null;
}

export function exchangeCode(
  platform: Platform,
  code: string,
  redirect: string,
  verifier?: string,
) {
  const creds = serverCreds(platform)!;
  if (platform === "twitch") {
    return postToken("https://id.twitch.tv/oauth2/token", {
      client_id: creds.id,
      client_secret: creds.secret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirect,
    });
  }
  return postToken("https://id.kick.com/oauth/token", {
    client_id: creds.id,
    client_secret: creds.secret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirect,
    code_verifier: verifier ?? "",
  });
}

/** Returns a fresh account (refreshing if the token is close to expiry), or null if it can't be refreshed. */
export async function ensureFresh(
  account: StoredAccount,
): Promise<{ account: StoredAccount; refreshed: boolean } | null> {
  if (account.expiresAt > Date.now() + 120_000) return { account, refreshed: false };
  const creds = serverCreds(account.platform);
  if (!creds || !account.refreshToken) return null;
  const data = await postToken(
    account.platform === "twitch"
      ? "https://id.twitch.tv/oauth2/token"
      : "https://id.kick.com/oauth/token",
    {
      client_id: creds.id,
      client_secret: creds.secret,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    },
  );
  if (!data?.access_token) return null;
  return {
    account: {
      ...account,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || account.refreshToken,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    },
    refreshed: true,
  };
}

// ---------- profile lookups ----------

export async function fetchTwitchSelf(token: string, clientId: string) {
  const res = await fetch("https://api.twitch.tv/helix/users", {
    headers: { "Client-Id": clientId, Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const json = (await res.json()) as {
    data?: Array<{ id: string; login: string; display_name: string; profile_image_url: string }>;
  };
  return json.data?.[0] ?? null;
}

export async function fetchKickSelf(token: string) {
  const res = await fetch("https://api.kick.com/public/v1/users", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const json = (await res.json()) as {
    data?: Array<{ user_id: number; name: string; profile_picture?: string }>;
  };
  const me = json.data?.[0];
  if (!me) return null;

  // The users endpoint returns a display name; resolve the channel slug for links/embeds.
  let slug = me.name.toLowerCase();
  const ch = await fetch(
    `https://api.kick.com/public/v1/channels?broadcaster_user_id=${me.user_id}`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    },
  ).catch(() => null);
  if (ch?.ok) {
    const cj = (await ch.json().catch(() => null)) as { data?: Array<{ slug?: string }> } | null;
    if (cj?.data?.[0]?.slug) slug = cj.data[0].slug;
  }
  return { ...me, slug };
}

/** All channels the Twitch user follows, with avatars. Capped at 500. */
export async function fetchTwitchFollows(
  account: StoredAccount,
  clientId: string,
): Promise<FollowedChannel[]> {
  const headers = { "Client-Id": clientId, Authorization: `Bearer ${account.accessToken}` };
  const follows: Array<{
    broadcaster_id: string;
    broadcaster_login: string;
    broadcaster_name: string;
    followed_at: string;
  }> = [];
  let cursor: string | undefined;

  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({ user_id: account.userId, first: "100" });
    if (cursor) qs.set("after", cursor);
    const res = await fetch(`https://api.twitch.tv/helix/channels/followed?${qs}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      if (page === 0) throw new Error(`twitch_follows_${res.status}`);
      break;
    }
    const json = (await res.json()) as {
      data?: typeof follows;
      pagination?: { cursor?: string };
    };
    follows.push(...(json.data ?? []));
    cursor = json.pagination?.cursor;
    if (!cursor) break;
  }

  const avatars = new Map<string, string>();
  for (let i = 0; i < follows.length; i += 100) {
    const qs = follows
      .slice(i, i + 100)
      .map((f) => `id=${encodeURIComponent(f.broadcaster_id)}`)
      .join("&");
    const res = await fetch(`https://api.twitch.tv/helix/users?${qs}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    }).catch(() => null);
    if (!res?.ok) continue;
    const json = (await res.json()) as { data?: Array<{ id: string; profile_image_url: string }> };
    for (const u of json.data ?? []) avatars.set(u.id, u.profile_image_url);
  }

  return follows.map((f) => ({
    id: `twitch:${f.broadcaster_login.toLowerCase()}`,
    platform: "twitch" as const,
    slug: f.broadcaster_login.toLowerCase(),
    displayName: f.broadcaster_name,
    avatarUrl: avatars.get(f.broadcaster_id),
    addedAt: new Date(f.followed_at).getTime() || Date.now(),
    source: "twitch-follow" as const,
  }));
}

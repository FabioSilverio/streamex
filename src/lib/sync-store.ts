import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { NextRequest, NextResponse } from "next/server";
import {
  ensureFresh,
  readAccount,
  serverCreds,
  writeAccount,
  type StoredAccount,
} from "@/lib/oauth";
import {
  EMPTY_SYNC_STATE,
  mergeSyncState,
  sanitizeSyncState,
  type SyncState,
} from "@/lib/sync-merge";

let redis: Redis | null | undefined;

/** Upstash via the Vercel Marketplace sets KV_REST_API_*; plain Upstash uses UPSTASH_REDIS_REST_*. */
export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

// ---------- identity ----------

/**
 * The account cookie is httpOnly but not signed, so its user id can't be trusted on its own.
 * We ask Twitch/Kick who the access token belongs to, and cache that answer briefly.
 */
const verifiedCache = new Map<string, { userId: string; until: number }>();
const VERIFY_TTL_MS = 10 * 60 * 1000;

const tokenKey = (platform: string, token: string) =>
  `${platform}:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;

async function verifiedUserId(account: StoredAccount): Promise<string | null> {
  const key = tokenKey(account.platform, account.accessToken);
  const hit = verifiedCache.get(key);
  if (hit && hit.until > Date.now()) return hit.userId;

  let userId: string | null = null;
  if (account.platform === "twitch") {
    const res = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${account.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    if (res?.ok) {
      const data = (await res.json().catch(() => null)) as { user_id?: string } | null;
      userId = data?.user_id ?? null;
    }
  } else {
    const res = await fetch("https://api.kick.com/public/v1/users", {
      headers: { Authorization: `Bearer ${account.accessToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    if (res?.ok) {
      const data = (await res.json().catch(() => null)) as {
        data?: Array<{ user_id?: number }>;
      } | null;
      const id = data?.data?.[0]?.user_id;
      userId = id !== undefined ? String(id) : null;
    }
  }

  if (userId) verifiedCache.set(key, { userId, until: Date.now() + VERIFY_TTL_MS });
  return userId;
}

export interface SyncIdentity {
  /** Redis key of the profile this device reads and writes. */
  profileKey: string;
  twitchId: string | null;
  kickId: string | null;
}

/**
 * Resolve who is syncing. Twitch is the primary identity; Kick alone also works.
 * Refreshed tokens are written back to the response cookies.
 */
export async function resolveIdentity(
  req: NextRequest,
  res: NextResponse,
): Promise<SyncIdentity | null> {
  const r = getRedis();
  if (!r) return null;

  let twitchId: string | null = null;
  let kickId: string | null = null;

  for (const platform of ["twitch", "kick"] as const) {
    const stored = readAccount(req, platform);
    if (!stored || !serverCreds(platform)) continue;
    const fresh = await ensureFresh(stored);
    if (!fresh) continue;
    if (fresh.refreshed) writeAccount(req, res, fresh.account);
    const id = await verifiedUserId(fresh.account);
    if (!id) continue;
    if (platform === "twitch") twitchId = id;
    else kickId = id;
  }

  if (twitchId) {
    const profileKey = `profile:twitch:${twitchId}`;
    if (kickId) {
      // Link Kick → Twitch, and fold in anything saved while only Kick was connected.
      const aliasKey = `alias:kick:${kickId}`;
      const existing = await r.get<string>(aliasKey);
      if (existing !== profileKey) {
        await r.set(aliasKey, profileKey);
        const orphan = await r.get<SyncState>(`profile:kick:${kickId}`);
        if (orphan) {
          const current = sanitizeSyncState(await r.get(profileKey));
          await r.set(profileKey, mergeSyncState(current, sanitizeSyncState(orphan)));
          await r.del(`profile:kick:${kickId}`);
        }
      }
    }
    return { profileKey, twitchId, kickId };
  }
  if (kickId) {
    const alias = await r.get<string>(`alias:kick:${kickId}`);
    return { profileKey: alias || `profile:kick:${kickId}`, twitchId: null, kickId };
  }
  return null;
}

export async function syncProfile(identity: SyncIdentity, incoming: SyncState): Promise<SyncState> {
  const r = getRedis()!;
  const stored = sanitizeSyncState((await r.get(identity.profileKey)) ?? EMPTY_SYNC_STATE);
  // Device state first so its channel order is kept; per-item timestamps decide conflicts.
  const merged = mergeSyncState(incoming, stored);
  await r.set(identity.profileKey, merged);
  return merged;
}

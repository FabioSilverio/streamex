import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** What the desktop ticker shows. Labels are what you read; symbols are Yahoo Finance's. */
const SYMBOLS: Array<{ symbol: string; label: string; kind: "stock" | "index" | "fx" | "crypto" }> =
  [
    { symbol: "NVDA", label: "NVIDIA", kind: "stock" },
    { symbol: "SPCX", label: "SpaceX", kind: "stock" },
    { symbol: "ANT", label: "Anthropic", kind: "stock" },
    { symbol: "AAPL", label: "Apple", kind: "stock" },
    { symbol: "META", label: "Meta", kind: "stock" },
    { symbol: "MSFT", label: "Microsoft", kind: "stock" },
    { symbol: "GOOGL", label: "Google", kind: "stock" },
    { symbol: "AMZN", label: "Amazon", kind: "stock" },
    { symbol: "TSLA", label: "Tesla", kind: "stock" },
    { symbol: "^GSPC", label: "S&P 500", kind: "index" },
    { symbol: "^IXIC", label: "Nasdaq", kind: "index" },
    { symbol: "^BVSP", label: "Ibovespa", kind: "index" },
    { symbol: "BRL=X", label: "Dólar", kind: "fx" },
    { symbol: "EURBRL=X", label: "Euro", kind: "fx" },
    { symbol: "BTC-USD", label: "Bitcoin", kind: "crypto" },
    { symbol: "ETH-USD", label: "Ethereum", kind: "crypto" },
  ];

export interface TickerQuote {
  symbol: string;
  label: string;
  kind: "stock" | "index" | "fx" | "crypto";
  price: number;
  changePct: number;
  currency: string;
}
export interface TickerNews {
  title: string;
  url: string;
  points: number;
}

const QUOTES_TTL_MS = 60_000;
const NEWS_TTL_MS = 5 * 60_000;
let quotesCache: { at: number; data: TickerQuote[] } | null = null;
let newsCache: { at: number; data: TickerNews[] } | null = null;

async function fetchQuote(s: (typeof SYMBOLS)[number]): Promise<TickerQuote | null> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.symbol)}?range=1d&interval=1d`,
    {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    },
  ).catch(() => null);
  if (!res?.ok) return null;
  const json = (await res.json().catch(() => null)) as {
    chart?: {
      result?: Array<{
        meta?: {
          regularMarketPrice?: number;
          chartPreviousClose?: number;
          previousClose?: number;
          currency?: string;
        };
      }>;
    };
  } | null;
  const meta = json?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  const prev = meta?.chartPreviousClose ?? meta?.previousClose;
  if (typeof price !== "number") return null;
  return {
    symbol: s.symbol,
    label: s.label,
    kind: s.kind,
    price,
    changePct: typeof prev === "number" && prev > 0 ? ((price - prev) / prev) * 100 : 0,
    currency: meta?.currency || "USD",
  };
}

async function getQuotes(): Promise<TickerQuote[]> {
  if (quotesCache && Date.now() - quotesCache.at < QUOTES_TTL_MS) return quotesCache.data;
  const results = await Promise.all(SYMBOLS.map(fetchQuote));
  const data = results.filter((q): q is TickerQuote => q !== null);
  // keep the last good set if Yahoo hiccups
  if (data.length > 0 || !quotesCache) quotesCache = { at: Date.now(), data };
  return quotesCache.data;
}

async function getNews(): Promise<TickerNews[]> {
  if (newsCache && Date.now() - newsCache.at < NEWS_TTL_MS) return newsCache.data;
  const res = await fetch("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=12", {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  const json = res?.ok
    ? ((await res.json().catch(() => null)) as {
        hits?: Array<{ title?: string; url?: string | null; objectID: string; points?: number }>;
      } | null)
    : null;
  const data: TickerNews[] = (json?.hits ?? [])
    .filter((h) => h.title)
    .map((h) => ({
      title: h.title!,
      // Ask/Show HN posts have no external url — link the discussion
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      points: h.points ?? 0,
    }));
  if (data.length > 0 || !newsCache) newsCache = { at: Date.now(), data };
  return newsCache.data;
}

export async function GET() {
  const [quotes, news] = await Promise.all([getQuotes(), getNews()]);
  return NextResponse.json(
    { quotes, news, fetchedAt: Date.now() },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}

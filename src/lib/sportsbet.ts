import {
  DEFAULT_BOOKMAKER,
  getBookmaker,
  type BookmakerId,
} from "./bookmakers";
import { resolveTeamId, resolveTeamIdLoose } from "./teams";
import type { CandidateLeg, MarketType } from "./types";
import { combineOdds, confidenceFromFactors, roundOdds, valueScore } from "./engine/odds";

const BASE = "https://api.the-odds-api.com/v4";
const SPORT = "aussierules_afl";

export interface SportsbetStatus {
  configured: boolean;
  connected: boolean;
  message: string;
  bookmakerId?: BookmakerId;
  bookmakerLabel?: string;
  bookmakerShort?: string;
  remainingRequests?: number | null;
  lastError?: string;
  /** True when Odds API returned OUT_OF_USAGE_CREDITS */
  quotaExhausted?: boolean;
  /** Served from shared/server cache (same prices, no new Odds API spend) */
  cached?: boolean;
  /** When the cached board was fetched (ISO) */
  cachedAt?: string;
}

/** Live head-to-head prices for fixture tiles (cheap: 1 Odds API credit for the slate). */
export interface MatchH2hPrice {
  homeTeam: string;
  awayTeam: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeOdds: number;
  awayOdds: number;
  eventLink?: string;
  lastUpdate?: string;
}

export interface SportsbetPriceLine {
  marketKey: string;
  name: string;
  description?: string;
  price: number;
  point?: number;
  link?: string;
}

export interface SportsbetEventOdds {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  lastUpdate?: string;
  eventLink?: string;
  lines: SportsbetPriceLine[];
}

interface OddsApiOutcome {
  name: string;
  description?: string;
  price: number;
  point?: number;
  link?: string;
}

interface OddsApiMarket {
  key: string;
  last_update?: string;
  /** Deep link to this market on the book, when Odds API provides it */
  link?: string;
  outcomes: OddsApiOutcome[];
}

interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update?: string;
  link?: string;
  markets: OddsApiMarket[];
}

interface OddsApiEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers?: OddsApiBookmaker[];
}

function getApiKey(): string | null {
  const key = process.env.ODDS_API_KEY?.trim();
  return key && key.length > 5 ? key : null;
}

export function getSportsbetConfigStatus(
  bookmakerId: BookmakerId = DEFAULT_BOOKMAKER,
): SportsbetStatus {
  const book = getBookmaker(bookmakerId);
  if (!getApiKey()) {
    return {
      configured: false,
      connected: false,
      bookmakerId: book.id,
      bookmakerLabel: book.label,
      bookmakerShort: book.shortLabel,
      message: `Add ODDS_API_KEY to link live ${book.label} prices via The Odds API (free tier available).`,
    };
  }
  return {
    configured: true,
    connected: false,
    bookmakerId: book.id,
    bookmakerLabel: book.label,
    bookmakerShort: book.shortLabel,
    message: `${book.label} key configured — prices load on scan.`,
  };
}

function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /magpies|blues|bombers|dockers|cats|suns|giants|hawks|demons|kangaroos|power|tigers|saints|swans|eagles|bulldogs|lions|crows/g,
      "",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Strict player match — no loose substring hits that grab the wrong athlete. */
function playerNamesMatch(a: string, b: string): boolean {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const aParts = na.split(" ").filter(Boolean);
  const bParts = nb.split(" ").filter(Boolean);
  if (aParts.length < 2 || bParts.length < 2) return false;

  const aFirst = aParts[0];
  const bFirst = bParts[0];
  const aLast = aParts[aParts.length - 1];
  const bLast = bParts[bParts.length - 1];

  // Exact first + last
  if (aFirst === bFirst && aLast === bLast) return true;
  // Initial + last (e.g. D Parish vs Darcy Parish)
  if (aLast === bLast && aFirst[0] === bFirst[0] && (aFirst.length === 1 || bFirst.length === 1)) {
    return true;
  }
  return false;
}

function teamNamesMatch(a: string, b: string): boolean {
  const aId = resolveTeamIdLoose(a);
  const bId = resolveTeamIdLoose(b);
  if (aId && bId) return aId === bId;

  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  // Never let "Melbourne" match "North Melbourne" via substring
  if (aId || bId) return false;
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length <= nb.length ? nb : na;
    // Only allow includes when the shorter token is a full word-ish chunk
    // and not a different club's core name
    if (shorter.length < 5) return false;
    if (longer !== shorter && longer.split(" ").includes(shorter)) return true;
  }
  return false;
}

/**
 * Map our N+ milestone to Sportsbet over-line points.
 * Prefer exact Over (N-0.5); also accept integer N when books price milestones that way.
 */
function matchingOverPoints(threshold: number): number[] {
  return [threshold - 0.5, threshold];
}

function isOverOutcome(name: string): boolean {
  const n = name.toLowerCase().trim();
  return n === "over" || n === "yes" || n.startsWith("over ");
}

function pointMatchesThreshold(point: number | undefined, threshold: number): boolean {
  if (point == null || !Number.isFinite(point)) return false;
  return matchingOverPoints(threshold).some((p) => Math.abs(point - p) < 0.05);
}

function findPlayerOverLine(
  lines: SportsbetPriceLine[],
  marketKeys: string[],
  playerName: string,
  threshold: number,
): SportsbetPriceLine | null {
  const candidates = lines.filter((l) => {
    if (!marketKeys.includes(l.marketKey)) return false;
    if (!l.description || !playerNamesMatch(l.description, playerName)) return false;
    if (!isOverOutcome(l.name)) return false;
    return pointMatchesThreshold(l.point, threshold);
  });

  // Prefer the classic Over X.5 line when both X.5 and X exist
  const half = candidates.find((l) => l.point != null && Math.abs(l.point - (threshold - 0.5)) < 0.05);
  return half ?? candidates[0] ?? null;
}

function teamNamesCompatible(homeA: string, awayA: string, homeB: string, awayB: string): boolean {
  const aHome = resolveTeamIdLoose(homeA);
  const aAway = resolveTeamIdLoose(awayA);
  const bHome = resolveTeamIdLoose(homeB);
  const bAway = resolveTeamIdLoose(awayB);

  if (aHome && aAway && bHome && bAway) {
    return (
      (aHome === bHome && aAway === bAway) ||
      (aHome === bAway && aAway === bHome)
    );
  }
  return (
    (teamNamesMatch(homeA, homeB) && teamNamesMatch(awayA, awayB)) ||
    (teamNamesMatch(homeA, awayB) && teamNamesMatch(awayA, homeB))
  );
}

function parseOddsApiFailure(status: number, body: string): Error {
  const snippet = body.slice(0, 220);
  let code = "";
  try {
    const parsed = JSON.parse(body) as { error_code?: string; message?: string };
    code = parsed.error_code ?? "";
    if (code === "OUT_OF_USAGE_CREDITS" || /quota has been reached/i.test(body)) {
      const err = new Error(
        "Odds API quota exhausted — no live book prices until credits reset or you replace ODDS_API_KEY at the-odds-api.com",
      );
      (err as Error & { quotaExhausted?: boolean }).quotaExhausted = true;
      return err;
    }
    if (parsed.message) {
      return new Error(`Odds API ${status}: ${parsed.message.slice(0, 160)}`);
    }
  } catch {
    /* plain text body */
  }
  return new Error(`Odds API ${status}: ${snippet}`);
}

async function oddsFetch(
  path: string,
  opts?: { revalidate?: number | false },
): Promise<{
  data: unknown;
  remaining: number | null;
}> {
  const key = getApiKey();
  if (!key) throw new Error("ODDS_API_KEY not set");

  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(key)}`;
  const revalidate = opts?.revalidate;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    ...(revalidate === false
      ? { cache: "no-store" as const }
      : { next: { revalidate: revalidate ?? 300 } }),
  });

  const remainingHeader = res.headers.get("x-requests-remaining");
  const remaining = remainingHeader != null ? Number(remainingHeader) : null;

  if (!res.ok) {
    const body = await res.text();
    throw parseOddsApiFailure(res.status, body);
  }

  return { data: await res.json(), remaining };
}

/** Free (0 credit) event list — also returns remaining quota in headers. */
export async function fetchAflEventList(): Promise<{
  events: { id: string; homeTeam: string; awayTeam: string; commenceTime: string }[];
  remaining: number | null;
}> {
  const { data, remaining } = await oddsFetch(`/sports/${SPORT}/events`, {
    revalidate: false,
  });
  const events = (data as OddsApiEvent[]).map((e) => ({
    id: e.id,
    homeTeam: e.home_team,
    awayTeam: e.away_team,
    commenceTime: e.commence_time,
  }));
  return { events, remaining };
}

/**
 * Lightweight status check — uses the free /events endpoint so the UI can
 * show "quota exhausted" without burning scan credits.
 */
export async function probeSportsbetStatus(
  bookmakerId: BookmakerId = DEFAULT_BOOKMAKER,
): Promise<SportsbetStatus> {
  const book = getBookmaker(bookmakerId);
  const base = getSportsbetConfigStatus(book.id);
  if (!base.configured) return base;

  try {
    const { events, remaining } = await fetchAflEventList();
    if (remaining != null && remaining <= 0) {
      return {
        configured: true,
        connected: false,
        bookmakerId: book.id,
        bookmakerLabel: book.label,
        bookmakerShort: book.shortLabel,
        remainingRequests: remaining,
        quotaExhausted: true,
        message: `Odds API quota exhausted (${remaining} credits) — live ${book.shortLabel} prices unavailable`,
        lastError:
          "Replace or top up ODDS_API_KEY at the-odds-api.com, then redeploy. Free tier resets monthly.",
      };
    }
    return {
      configured: true,
      connected: true,
      bookmakerId: book.id,
      bookmakerLabel: book.label,
      bookmakerShort: book.shortLabel,
      remainingRequests: remaining,
      message: `${book.label} ready — ${events.length} AFL event${events.length === 1 ? "" : "s"} on Odds API${
        remaining != null ? ` · ${remaining} credits left` : ""
      }.`,
    };
  } catch (err) {
    const quotaExhausted = Boolean(
      (err as Error & { quotaExhausted?: boolean })?.quotaExhausted,
    );
    return {
      configured: true,
      connected: false,
      bookmakerId: book.id,
      bookmakerLabel: book.label,
      bookmakerShort: book.shortLabel,
      quotaExhausted,
      message: quotaExhausted
        ? `Odds API quota exhausted — live ${book.shortLabel} prices unavailable`
        : `${book.label} probe failed — using Bounce model odds.`,
      lastError: err instanceof Error ? err.message : "Probe failed",
    };
  }
}

type H2hSnapshot = {
  fetchedAt: string;
  prices: MatchH2hPrice[];
  status: SportsbetStatus;
};

let h2hMemory: { key: string; expiresAt: number; snap: H2hSnapshot } | null =
  null;

function extractH2hPrice(event: SportsbetEventOdds): MatchH2hPrice | null {
  const h2h = event.lines.filter((l) => l.marketKey === "h2h");
  if (h2h.length < 2) return null;

  const homeId = resolveTeamIdLoose(event.homeTeam);
  const awayId = resolveTeamIdLoose(event.awayTeam);

  const pick = (teamName: string, teamId: string | null) => {
    // Prefer TeamId match; fall back to strict name match
    const byId = teamId
      ? h2h.find((l) => resolveTeamIdLoose(l.name) === teamId)
      : undefined;
    if (byId) return byId;
    return h2h.find((l) => teamNamesMatch(l.name, teamName));
  };

  const home = pick(event.homeTeam, homeId);
  const away = pick(event.awayTeam, awayId);
  if (!home || !away) return null;
  // Same outcome matched twice (North Melbourne ⊆ Melbourne bug) — reject
  if (home === away || home.name === away.name) return null;
  if (!Number.isFinite(home.price) || !Number.isFinite(away.price)) return null;

  return {
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    homeTeamId: homeId ?? undefined,
    awayTeamId: awayId ?? undefined,
    homeOdds: roundOdds(home.price),
    awayOdds: roundOdds(away.price),
    eventLink: home.link ?? away.link ?? event.eventLink,
    lastUpdate: event.lastUpdate,
  };
}

async function fetchH2hPricesUncached(
  bookmakerId: BookmakerId,
): Promise<H2hSnapshot> {
  const book = getBookmaker(bookmakerId);
  const fetchedAt = new Date().toISOString();
  try {
    // 1 market × 1 region = 1 credit for the entire AFL slate
    const { data, remaining } = await oddsFetch(
      `/sports/${SPORT}/odds?regions=au&bookmakers=${book.apiKey}&markets=h2h&oddsFormat=decimal&includeLinks=true`,
      { revalidate: SHARED_BOARD_REVALIDATE_SEC },
    );
    const events = (data as OddsApiEvent[])
      .map((e) => extractSportsbet(e, book.apiKey))
      .filter((e): e is SportsbetEventOdds => e !== null);
    const prices = events
      .map(extractH2hPrice)
      .filter((p): p is MatchH2hPrice => p !== null);

    return {
      fetchedAt,
      prices,
      status: {
        configured: true,
        connected: prices.length > 0,
        bookmakerId: book.id,
        bookmakerLabel: book.label,
        bookmakerShort: book.shortLabel,
        remainingRequests: remaining,
        message:
          prices.length > 0
            ? `${book.label} H2H prices for ${prices.length} fixture${prices.length === 1 ? "" : "s"}.`
            : `Connected, but no ${book.label} H2H markets on Odds API yet.`,
      },
    };
  } catch (err) {
    const quotaExhausted = Boolean(
      (err as Error & { quotaExhausted?: boolean })?.quotaExhausted,
    );
    return {
      fetchedAt,
      prices: [],
      status: {
        configured: true,
        connected: false,
        bookmakerId: book.id,
        bookmakerLabel: book.label,
        bookmakerShort: book.shortLabel,
        quotaExhausted,
        message: quotaExhausted
          ? `Odds API quota exhausted — live ${book.shortLabel} prices unavailable`
          : `${book.label} H2H fetch failed.`,
        lastError: err instanceof Error ? err.message : "Unknown error",
      },
    };
  }
}

/**
 * Live match-winner prices for fixture tiles.
 * One Odds API credit for the whole AFL slate (h2h only), shared 12-min cache.
 */
export async function loadBookmakerH2hPrices(
  bookmakerId: BookmakerId = DEFAULT_BOOKMAKER,
): Promise<{ prices: MatchH2hPrice[]; status: SportsbetStatus }> {
  const book = getBookmaker(bookmakerId);
  const base = getSportsbetConfigStatus(book.id);
  if (!base.configured) {
    return { prices: [], status: base };
  }

  const cacheKey = `h2h|${book.id}`;
  if (h2hMemory && h2hMemory.key === cacheKey && h2hMemory.expiresAt > Date.now()) {
    return {
      prices: h2hMemory.snap.prices,
      status: {
        ...h2hMemory.snap.status,
        cached: true,
        cachedAt: h2hMemory.snap.fetchedAt,
        message: `${h2hMemory.snap.status.message.replace(/ \(shared cache.*\)$/, "")} (memory cache)`,
      },
    };
  }

  const { unstable_cache } = await import("next/cache");
  const readShared = unstable_cache(
    async () => fetchH2hPricesUncached(book.id),
    ["sportsbet-h2h-v2", book.id],
    { revalidate: SHARED_BOARD_REVALIDATE_SEC, tags: ["sportsbet-h2h"] },
  );
  const snap = await readShared();
  const fromCache =
    Date.now() - Date.parse(snap.fetchedAt) > 2_000 &&
    !snap.status.quotaExhausted &&
    !snap.status.lastError &&
    snap.prices.length > 0;

  const ageSec = Math.max(
    0,
    Math.round((Date.now() - Date.parse(snap.fetchedAt)) / 1000),
  );
  const ageLabel =
    ageSec < 60 ? `${ageSec}s ago` : `${Math.round(ageSec / 60)}m ago`;

  const status: SportsbetStatus = {
    ...snap.status,
    cached: fromCache,
    cachedAt: snap.fetchedAt,
    message: fromCache
      ? `${snap.status.message.replace(/ \(shared cache.*\)$/, "")} (shared cache · ${ageLabel})`
      : snap.status.message,
  };

  if (!snap.status.quotaExhausted && !snap.status.lastError) {
    h2hMemory = {
      key: cacheKey,
      expiresAt: Date.now() + BOARD_CACHE_TTL_MS,
      snap: { ...snap, status },
    };
  }

  return { prices: snap.prices, status };
}

/** Match a Squiggle fixture to a cached H2H price row. */
export function findH2hPriceForMatchup(
  prices: MatchH2hPrice[],
  homeTeam: string,
  awayTeam: string,
  homeTeamId?: string,
  awayTeamId?: string,
): MatchH2hPrice | undefined {
  const homeId = homeTeamId ?? resolveTeamIdLoose(homeTeam) ?? undefined;
  const awayId = awayTeamId ?? resolveTeamIdLoose(awayTeam) ?? undefined;

  if (homeId && awayId) {
    const byId = prices.find(
      (p) =>
        (p.homeTeamId === homeId && p.awayTeamId === awayId) ||
        (p.homeTeamId === awayId && p.awayTeamId === homeId),
    );
    if (byId) return byId;
  }

  return prices.find((p) =>
    teamNamesCompatible(homeTeam, awayTeam, p.homeTeam, p.awayTeam),
  );
}

function extractSportsbet(
  event: OddsApiEvent,
  bookmakerKey: string,
): SportsbetEventOdds | null {
  const book = event.bookmakers?.find((b) => b.key === bookmakerKey);
  if (!book) return null;

  const lines: SportsbetPriceLine[] = [];
  for (const market of book.markets ?? []) {
    for (const outcome of market.outcomes ?? []) {
      lines.push({
        marketKey: market.key,
        name: outcome.name,
        description: outcome.description,
        price: outcome.price,
        point: outcome.point,
        // Prefer deepest available deep-link: outcome → market → event
        link: outcome.link ?? market.link ?? book.link,
      });
    }
  }

  return {
    eventId: event.id,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    commenceTime: event.commence_time,
    lastUpdate: book.last_update,
    eventLink: book.link,
    lines,
  };
}

/**
 * One event-odds call per fixture: match markets + player props.
 * Cost = markets × regions (au) per event — keep this list tight.
 */
const EVENT_MARKETS = [
  "h2h",
  "totals",
  "player_goal_scorer_anytime",
  "player_goals_scored_over",
  "player_disposals_over",
  "player_tackles_over",
  "player_marks_over",
].join(",");

const MAX_BOARD_EVENTS = 5;
/** In-process L1 (same warm instance). */
const BOARD_CACHE_TTL_MS = 12 * 60 * 1000;
/**
 * Shared L2 via Next.js Data Cache (survives cold starts on Vercel).
 * Same boards/prices — only avoids re-spending Odds API credits.
 */
const SHARED_BOARD_REVALIDATE_SEC = 12 * 60;

type BoardCache = {
  key: string;
  expiresAt: number;
  byMatchup: Map<string, SportsbetEventOdds>;
  status: SportsbetStatus;
};

/** JSON-serializable board for Next.js shared Data Cache. */
type BoardSnapshot = {
  fetchedAt: string;
  entries: [string, SportsbetEventOdds][];
  status: SportsbetStatus;
};

let boardCache: BoardCache | null = null;

function matchupsCacheKey(
  matchups: { homeTeam: string; awayTeam: string }[],
  bookmakerId: BookmakerId,
): string {
  const parts = matchups
    .map(
      (m) =>
        `${normalizeName(m.homeTeam)}:${normalizeName(m.awayTeam)}`,
    )
    .sort();
  return `${bookmakerId}|${parts.join(";")}`;
}

function storeBoardAliases(
  byMatchup: Map<string, SportsbetEventOdds>,
  board: SportsbetEventOdds,
  aliases: { homeTeam: string; awayTeam: string }[],
) {
  const keys = new Set<string>();
  for (const a of aliases) {
    keys.add(`${normalizeName(a.homeTeam)}|${normalizeName(a.awayTeam)}`);
    keys.add(`${normalizeName(a.awayTeam)}|${normalizeName(a.homeTeam)}`);
    const homeId = resolveTeamId(a.homeTeam);
    const awayId = resolveTeamId(a.awayTeam);
    if (homeId && awayId) {
      keys.add(`${homeId}|${awayId}`);
      keys.add(`${awayId}|${homeId}`);
    }
  }
  for (const key of keys) byMatchup.set(key, board);
}

function snapshotToResult(
  snap: BoardSnapshot,
  fromCache: boolean,
): {
  byMatchup: Map<string, SportsbetEventOdds>;
  status: SportsbetStatus;
} {
  const byMatchup = new Map<string, SportsbetEventOdds>(snap.entries);
  const ageSec = Math.max(
    0,
    Math.round((Date.now() - Date.parse(snap.fetchedAt)) / 1000),
  );
  const ageLabel =
    ageSec < 60 ? `${ageSec}s ago` : `${Math.round(ageSec / 60)}m ago`;
  return {
    byMatchup,
    status: {
      ...snap.status,
      cached: fromCache,
      cachedAt: snap.fetchedAt,
      message: fromCache
        ? `${snap.status.message.replace(/ \(cached.*\)$/, "")} (shared cache · ${ageLabel})`
        : snap.status.message,
    },
  };
}

function rememberBoard(
  cacheKey: string,
  byMatchup: Map<string, SportsbetEventOdds>,
  status: SportsbetStatus,
) {
  boardCache = {
    key: cacheKey,
    expiresAt: Date.now() + BOARD_CACHE_TTL_MS,
    byMatchup,
    status,
  };
}

export async function fetchSportsbetEventOdds(
  eventId: string,
  bookmakerId: BookmakerId = DEFAULT_BOOKMAKER,
): Promise<{ board: SportsbetEventOdds | null; remaining: number | null }> {
  const book = getBookmaker(bookmakerId);
  const { data, remaining } = await oddsFetch(
    `/sports/${SPORT}/events/${eventId}/odds?regions=au&bookmakers=${book.apiKey}&markets=${EVENT_MARKETS}&oddsFormat=decimal&includeLinks=true`,
    { revalidate: SHARED_BOARD_REVALIDATE_SEC },
  );
  return {
    board: extractSportsbet(data as OddsApiEvent, book.apiKey),
    remaining,
  };
}

/** Paid Odds API board build — no caching layer. */
async function fetchSportsbetBoardUncached(
  matchups: { homeTeam: string; awayTeam: string }[],
  bookmakerId: BookmakerId,
): Promise<BoardSnapshot> {
  const book = getBookmaker(bookmakerId);
  const byMatchup = new Map<string, SportsbetEventOdds>();
  const fetchedAt = new Date().toISOString();

  try {
    const { events, remaining: listRemaining } = await fetchAflEventList();
    if (listRemaining != null && listRemaining <= 0) {
      return {
        fetchedAt,
        entries: [],
        status: {
          configured: true,
          connected: false,
          bookmakerId: book.id,
          bookmakerLabel: book.label,
          bookmakerShort: book.shortLabel,
          remainingRequests: listRemaining,
          quotaExhausted: true,
          message: `Odds API quota exhausted — live ${book.shortLabel} prices unavailable`,
          lastError:
            "Replace or top up ODDS_API_KEY at the-odds-api.com, then redeploy.",
        },
      };
    }

    const pairs: {
      matchup: { homeTeam: string; awayTeam: string };
      eventId: string;
      homeTeam: string;
      awayTeam: string;
    }[] = [];
    for (const m of matchups) {
      const hit = events.find((e) =>
        teamNamesCompatible(m.homeTeam, m.awayTeam, e.homeTeam, e.awayTeam),
      );
      if (hit) {
        pairs.push({
          matchup: m,
          eventId: hit.id,
          homeTeam: hit.homeTeam,
          awayTeam: hit.awayTeam,
        });
      }
    }

    const limited = pairs.slice(0, MAX_BOARD_EVENTS);
    let remaining = listRemaining;
    let loaded = 0;
    let propLines = 0;

    await Promise.all(
      limited.map(async ({ matchup, eventId, homeTeam, awayTeam }) => {
        try {
          const { board, remaining: rem } = await fetchSportsbetEventOdds(
            eventId,
            book.id,
          );
          if (rem != null) remaining = rem;
          if (!board) return;
          loaded += 1;
          propLines += board.lines.filter((l) =>
            l.marketKey.startsWith("player_"),
          ).length;
          storeBoardAliases(byMatchup, board, [
            { homeTeam, awayTeam },
            { homeTeam: matchup.homeTeam, awayTeam: matchup.awayTeam },
          ]);
        } catch (err) {
          if ((err as Error & { quotaExhausted?: boolean })?.quotaExhausted) {
            throw err;
          }
        }
      }),
    );

    return {
      fetchedAt,
      entries: [...byMatchup.entries()],
      status: {
        configured: true,
        connected: loaded > 0,
        bookmakerId: book.id,
        bookmakerLabel: book.label,
        bookmakerShort: book.shortLabel,
        remainingRequests: remaining,
        message:
          loaded > 0
            ? `${book.label} prices linked for ${loaded} fixture${loaded === 1 ? "" : "s"} (${propLines} player lines).`
            : pairs.length === 0
              ? `Connected, but no Odds API events matched this Squiggle slate yet.`
              : `Matched ${pairs.length} fixture${pairs.length === 1 ? "" : "s"} but ${book.label} returned no markets.`,
      },
    };
  } catch (err) {
    const quotaExhausted = Boolean(
      (err as Error & { quotaExhausted?: boolean })?.quotaExhausted,
    );
    return {
      fetchedAt,
      entries: [...byMatchup.entries()],
      status: {
        configured: true,
        connected: false,
        bookmakerId: book.id,
        bookmakerLabel: book.label,
        bookmakerShort: book.shortLabel,
        quotaExhausted,
        message: quotaExhausted
          ? `Odds API quota exhausted — live ${book.shortLabel} prices unavailable`
          : `${book.label} link failed — using Bounce model odds.`,
        lastError: err instanceof Error ? err.message : "Unknown error",
      },
    };
  }
}

/**
 * Load Sportsbet boards with L1 (memory) + L2 (Next.js shared Data Cache).
 * Cached hits return the same lines/prices — they just skip Odds API spend.
 */
export async function loadSportsbetBoard(
  matchups: {
    homeTeam: string;
    awayTeam: string;
  }[],
  bookmakerId: BookmakerId = DEFAULT_BOOKMAKER,
): Promise<{
  byMatchup: Map<string, SportsbetEventOdds>;
  status: SportsbetStatus;
}> {
  const book = getBookmaker(bookmakerId);
  const baseStatus = getSportsbetConfigStatus(book.id);
  if (!baseStatus.configured) {
    return { byMatchup: new Map(), status: baseStatus };
  }

  if (matchups.length === 0) {
    const probed = await probeSportsbetStatus(book.id);
    return { byMatchup: new Map(), status: probed };
  }

  const cacheKey = matchupsCacheKey(matchups, book.id);

  // L1 — same warm instance
  if (
    boardCache &&
    boardCache.key === cacheKey &&
    boardCache.expiresAt > Date.now()
  ) {
    return {
      byMatchup: boardCache.byMatchup,
      status: {
        ...boardCache.status,
        cached: true,
        cachedAt: boardCache.status.cachedAt,
        message: boardCache.status.message.includes("(shared cache")
          ? boardCache.status.message
          : `${boardCache.status.message.replace(/ \(cached.*\)$/, "")} (memory cache)`,
      },
    };
  }

  // Free quota probe — avoid caching / paying when already exhausted
  try {
    const { remaining } = await fetchAflEventList();
    if (remaining != null && remaining <= 0) {
      return {
        byMatchup: new Map(),
        status: {
          configured: true,
          connected: false,
          bookmakerId: book.id,
          bookmakerLabel: book.label,
          bookmakerShort: book.shortLabel,
          remainingRequests: remaining,
          quotaExhausted: true,
          message: `Odds API quota exhausted — live ${book.shortLabel} prices unavailable`,
          lastError:
            "Replace or top up ODDS_API_KEY at the-odds-api.com, then redeploy.",
        },
      };
    }
  } catch (err) {
    const quotaExhausted = Boolean(
      (err as Error & { quotaExhausted?: boolean })?.quotaExhausted,
    );
    if (quotaExhausted) {
      return {
        byMatchup: new Map(),
        status: {
          configured: true,
          connected: false,
          bookmakerId: book.id,
          bookmakerLabel: book.label,
          bookmakerShort: book.shortLabel,
          quotaExhausted: true,
          message: `Odds API quota exhausted — live ${book.shortLabel} prices unavailable`,
          lastError: err instanceof Error ? err.message : "Quota check failed",
        },
      };
    }
  }

  // L2 — shared across Vercel instances (Next.js Data Cache)
  const { unstable_cache } = await import("next/cache");
  const matchupsCopy = matchups.map((m) => ({
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
  }));

  const readShared = unstable_cache(
    async () => fetchSportsbetBoardUncached(matchupsCopy, book.id),
    ["sportsbet-board-v1", cacheKey],
    { revalidate: SHARED_BOARD_REVALIDATE_SEC, tags: ["sportsbet-board"] },
  );

  const snap = await readShared();
  const fromCache =
    Date.now() - Date.parse(snap.fetchedAt) > 2_000 &&
    !snap.status.quotaExhausted &&
    !snap.status.lastError;

  // Never treat quota/error snapshots as warm shared hits worth L1 sticky cache
  const result = snapshotToResult(snap, fromCache && snap.entries.length > 0);
  if (
    !snap.status.quotaExhausted &&
    !snap.status.lastError &&
    (snap.entries.length > 0 || snap.status.connected)
  ) {
    rememberBoard(cacheKey, result.byMatchup, result.status);
  }

  return result;
}

function findSportsbetLine(
  board: SportsbetEventOdds | undefined,
  leg: CandidateLeg,
): SportsbetPriceLine | null {
  if (!board) return null;
  const lines = board.lines;

  if (leg.market === "match_result") {
    const team = leg.label.replace(/ Win$/, "");
    return (
      lines.find(
        (l) => l.marketKey === "h2h" && teamNamesMatch(l.name, team),
      ) ?? null
    );
  }

  if (leg.market === "total_points" && leg.threshold != null) {
    // Exact total line only — never fall back to a random Over
    return (
      lines.find(
        (l) =>
          l.marketKey === "totals" &&
          isOverOutcome(l.name) &&
          l.point != null &&
          Math.abs(l.point - leg.threshold!) < 0.05,
      ) ?? null
    );
  }

  if (!leg.playerName || leg.threshold == null) {
    // Anytime 1+ goals has threshold 1
    if (leg.market === "player_goal" && leg.playerName && (leg.threshold === 1 || leg.threshold == null)) {
      return (
        lines.find(
          (l) =>
            l.marketKey === "player_goal_scorer_anytime" &&
            l.description &&
            playerNamesMatch(l.description, leg.playerName!) &&
            (l.name.toLowerCase() === "yes" || isOverOutcome(l.name)),
        ) ?? null
      );
    }
    return null;
  }

  if (leg.market === "player_goal") {
    if (leg.threshold === 1) {
      return (
        lines.find(
          (l) =>
            l.marketKey === "player_goal_scorer_anytime" &&
            l.description &&
            playerNamesMatch(l.description, leg.playerName!) &&
            (l.name.toLowerCase() === "yes" || isOverOutcome(l.name)),
        ) ??
        findPlayerOverLine(
          lines,
          ["player_goals_scored_over"],
          leg.playerName,
          1,
        )
      );
    }
    return findPlayerOverLine(
      lines,
      ["player_goals_scored_over"],
      leg.playerName,
      leg.threshold,
    );
  }

  if (leg.market === "player_disposal") {
    return findPlayerOverLine(
      lines,
      ["player_disposals", "player_disposals_over"],
      leg.playerName,
      leg.threshold,
    );
  }

  if (leg.market === "player_tackle") {
    return findPlayerOverLine(
      lines,
      ["player_tackles_over"],
      leg.playerName,
      leg.threshold,
    );
  }

  if (leg.market === "player_mark") {
    return findPlayerOverLine(
      lines,
      ["player_marks_over"],
      leg.playerName,
      leg.threshold,
    );
  }

  return null;
}

function formatSportsbetSelection(line: SportsbetPriceLine, leg: CandidateLeg): string {
  if (leg.market === "match_result") return line.name;
  if (line.point != null && isOverOutcome(line.name)) {
    return `Over ${line.point}`;
  }
  if (line.name.toLowerCase() === "yes" && leg.threshold === 1) {
    return "Anytime scorer";
  }
  return line.point != null ? `${line.name} ${line.point}` : line.name;
}

export function applySportsbetPrices(
  legs: CandidateLeg[],
  board: SportsbetEventOdds | undefined,
  bookmakerId: BookmakerId = DEFAULT_BOOKMAKER,
): CandidateLeg[] {
  if (!board) return legs;
  const book = getBookmaker(bookmakerId);

  return legs.map((leg) => {
    const line = findSportsbetLine(board, leg);
    if (!line) return leg;

    const sportsbetOdds = roundOdds(line.price);
    const modelOdds = leg.odds;
    const bookImplied = 1 / Math.max(sportsbetOdds, 1.01);
    const selection = formatSportsbetSelection(line, leg);

    // If the book is much longer than Bounce, trust the book more —
    // inflated model form (e.g. fake marks) should not keep ~75% confidence.
    const stretch = sportsbetOdds / Math.max(modelOdds, 1.01);
    let probability = leg.probability;
    let confidence = leg.confidence;
    const factors = [...leg.factors];

    if (stretch >= 1.75) {
      const blend = Math.min(0.55, 0.2 + (stretch - 1.75) * 0.15);
      probability = leg.probability * (1 - blend) + bookImplied * blend;
      confidence = Math.min(
        confidence,
        confidenceFromFactors(probability, factors),
      );
      factors.push({
        key: "model-book-gap",
        label: "Model vs book",
        impact: "negative",
        detail: `${book.label} $${sportsbetOdds.toFixed(2)} is ${stretch.toFixed(1)}× Bounce model $${modelOdds.toFixed(2)} — probability nudged toward book`,
        weight: -0.025,
      });
    }

    const vsModel = valueScore(probability, sportsbetOdds);

    return {
      ...leg,
      probability,
      confidence,
      odds: sportsbetOdds,
      modelOdds,
      sportsbetOdds,
      sportsbetMarket: line.marketKey,
      sportsbetLink: line.link ?? board.eventLink,
      sportsbetPoint: line.point,
      sportsbetSelection: selection,
      valueScore: vsModel,
      factors: [
        ...factors,
        {
          key: "bookmaker",
          label: book.label,
          impact:
            stretch >= 1.75
              ? "negative"
              : sportsbetOdds > modelOdds * 1.05
                ? "positive"
                : sportsbetOdds < modelOdds * 0.95
                  ? "negative"
                  : "neutral",
          detail: `Live ${book.label} ${selection} @ $${sportsbetOdds.toFixed(2)} (model ~$${modelOdds.toFixed(2)}, book implied ${(bookImplied * 100).toFixed(0)}%)`,
          weight: stretch >= 1.75 ? -0.02 : 0,
        },
      ],
    };
  });
}

/** Milestone N+ from an Over line (Over 14.5 → 15, Over 15 → 15). */
function thresholdFromOverPoint(point: number): number {
  return Number.isInteger(point) ? point : Math.ceil(point);
}

function playerSurname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

type BoardLegSpec = {
  market: MarketType;
  label: string;
  shortLabel: string;
  playerName?: string;
  threshold?: number;
  correlationGroup: string;
  selection: string;
};

function boardLineToSpec(line: SportsbetPriceLine): BoardLegSpec | null {
  const price = line.price;
  if (!Number.isFinite(price) || price < 1.01 || price > 5) return null;

  if (line.marketKey === "h2h") {
    return {
      market: "match_result",
      label: `${line.name} Win`,
      shortLabel: `${line.name} W`,
      correlationGroup: "match-result",
      selection: line.name,
    };
  }

  if (line.marketKey === "totals" && isOverOutcome(line.name) && line.point != null) {
    return {
      market: "total_points",
      label: `Total Points Over ${line.point}`,
      shortLabel: `O${line.point}`,
      threshold: line.point,
      correlationGroup: "totals",
      selection: `Over ${line.point}`,
    };
  }

  if (
    line.marketKey === "player_goal_scorer_anytime" &&
    line.description &&
    (line.name.toLowerCase() === "yes" || isOverOutcome(line.name))
  ) {
    const player = line.description;
    return {
      market: "player_goal",
      label: `${player} 1+ Goals`,
      shortLabel: `${playerSurname(player)} 1+G`,
      playerName: player,
      threshold: 1,
      correlationGroup: `player:${normalizePersonName(player)}`,
      selection: "Anytime scorer",
    };
  }

  const playerOverMarkets: {
    keys: string[];
    market: MarketType;
    unit: string;
    short: string;
  }[] = [
    {
      keys: ["player_goals_scored_over"],
      market: "player_goal",
      unit: "Goals",
      short: "G",
    },
    {
      keys: ["player_disposals", "player_disposals_over"],
      market: "player_disposal",
      unit: "Disposals",
      short: "D",
    },
    {
      keys: ["player_tackles_over"],
      market: "player_tackle",
      unit: "Tackles",
      short: "T",
    },
    {
      keys: ["player_marks_over"],
      market: "player_mark",
      unit: "Marks",
      short: "M",
    },
  ];

  for (const spec of playerOverMarkets) {
    if (!spec.keys.includes(line.marketKey)) continue;
    if (!line.description || line.point == null || !isOverOutcome(line.name)) {
      return null;
    }
    const threshold = thresholdFromOverPoint(line.point);
    const player = line.description;
    return {
      market: spec.market,
      label: `${player} ${threshold}+ ${spec.unit}`,
      shortLabel: `${playerSurname(player)} ${threshold}+${spec.short}`,
      playerName: player,
      threshold,
      correlationGroup: `player:${normalizePersonName(player)}`,
      selection: `Over ${line.point}`,
    };
  }

  return null;
}

/**
 * Build scan legs directly from live book lines so bookmaker-only mode
 * always has fully priced candidates (not just model legs that happen to match).
 */
export function legsFromSportsbetBoard(
  board: SportsbetEventOdds,
  game: {
    id: number;
    homeTeam: string;
    awayTeam: string;
    homePlayers: { id: string; name: string; team: string }[];
    awayPlayers: { id: string; name: string; team: string }[];
  },
  bookmakerId: BookmakerId = DEFAULT_BOOKMAKER,
): CandidateLeg[] {
  const book = getBookmaker(bookmakerId);
  const roster = [...game.homePlayers, ...game.awayPlayers];
  const seen = new Set<string>();
  const legs: CandidateLeg[] = [];

  for (const line of board.lines) {
    const spec = boardLineToSpec(line);
    if (!spec) continue;

    const key = [
      spec.market,
      spec.playerName ? normalizePersonName(spec.playerName) : "",
      spec.threshold ?? "",
      spec.market === "match_result" ? normalizeName(line.name) : "",
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);

    const sportsbetOdds = roundOdds(line.price);
    // Mild vig haircut so confidence isn't just 1/odds
    const probability = Math.min(0.92, Math.max(0.08, (1 / sportsbetOdds) * 0.94));
    const player = spec.playerName
      ? roster.find((p) => playerNamesMatch(p.name, spec.playerName!))
      : undefined;

    const factors = [
      {
        key: "bookmaker",
        label: book.label,
        impact: "neutral" as const,
        detail: `Live ${book.label} ${spec.selection} @ $${sportsbetOdds.toFixed(2)}`,
        weight: 0,
      },
    ];

    legs.push({
      id: `${game.id}:sb:${key}:${sportsbetOdds}`,
      gameId: game.id,
      market: spec.market,
      label: spec.label,
      shortLabel: spec.shortLabel,
      playerId: player?.id,
      playerName: spec.playerName,
      teamId: player?.team as CandidateLeg["teamId"],
      threshold: spec.threshold,
      probability,
      odds: sportsbetOdds,
      modelOdds: undefined,
      sportsbetOdds,
      sportsbetMarket: line.marketKey,
      sportsbetLink: line.link ?? board.eventLink,
      sportsbetPoint: line.point,
      sportsbetSelection: spec.selection,
      sportsbetBoardLeg: true,
      confidence: confidenceFromFactors(probability, factors),
      valueScore: valueScore(probability, sportsbetOdds),
      factors,
      correlationGroup: spec.correlationGroup,
    });
  }

  return legs.sort((a, b) => a.odds - b.odds);
}

export function sportsbetCombinedOdds(legs: CandidateLeg[]): number | null {
  const prices = legs.map((l) => l.sportsbetOdds).filter((x): x is number => x != null);
  if (prices.length !== legs.length) return null;
  return combineOdds(prices);
}

export function lookupSportsbetBoard(
  map: Map<string, SportsbetEventOdds>,
  homeTeam: string,
  awayTeam: string,
): SportsbetEventOdds | undefined {
  const homeId = resolveTeamId(homeTeam);
  const awayId = resolveTeamId(awayTeam);
  return (
    map.get(`${normalizeName(homeTeam)}|${normalizeName(awayTeam)}`) ??
    map.get(`${normalizeName(awayTeam)}|${normalizeName(homeTeam)}`) ??
    (homeId && awayId ? map.get(`${homeId}|${awayId}`) : undefined) ??
    (homeId && awayId ? map.get(`${awayId}|${homeId}`) : undefined) ??
    // Last resort: scan boards with team-id compatible names
    [...map.values()].find((board) =>
      teamNamesCompatible(homeTeam, awayTeam, board.homeTeam, board.awayTeam),
    )
  );
}

/** Type guard helper for markets used when matching */
export function isPlayerMarket(market: MarketType): boolean {
  return (
    market === "player_goal" ||
    market === "player_disposal" ||
    market === "player_mark" ||
    market === "player_tackle"
  );
}

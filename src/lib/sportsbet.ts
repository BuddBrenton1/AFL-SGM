import { resolveTeamId } from "./teams";
import type { CandidateLeg, MarketType } from "./types";
import { combineOdds, roundOdds, valueScore } from "./engine/odds";

const BASE = "https://api.the-odds-api.com/v4";
const SPORT = "aussierules_afl";
const BOOKMAKER = "sportsbet";

export interface SportsbetStatus {
  configured: boolean;
  connected: boolean;
  message: string;
  remainingRequests?: number | null;
  lastError?: string;
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

export function getSportsbetConfigStatus(): SportsbetStatus {
  if (!getApiKey()) {
    return {
      configured: false,
      connected: false,
      message:
        "Add ODDS_API_KEY to link live Sportsbet prices via The Odds API (free tier available).",
    };
  }
  return {
    configured: true,
    connected: false,
    message: "Sportsbet key configured — prices load on scan.",
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
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
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
  const aHome = resolveTeamId(homeA.replace(/ Magpies| Lions/g, "").trim()) ?? resolveTeamId(homeA);
  const aAway = resolveTeamId(awayA.replace(/ Magpies| Lions/g, "").trim()) ?? resolveTeamId(awayA);
  const bHome = resolveTeamId(homeB.replace(/ Magpies| Lions/g, "").trim()) ?? resolveTeamId(homeB);
  const bAway = resolveTeamId(awayB.replace(/ Magpies| Lions/g, "").trim()) ?? resolveTeamId(awayB);

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

async function oddsFetch(path: string): Promise<{
  data: unknown;
  remaining: number | null;
}> {
  const key = getApiKey();
  if (!key) throw new Error("ODDS_API_KEY not set");

  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 120 },
  });

  const remainingHeader = res.headers.get("x-requests-remaining");
  const remaining = remainingHeader != null ? Number(remainingHeader) : null;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Odds API ${res.status}: ${body.slice(0, 180)}`);
  }

  return { data: await res.json(), remaining };
}

function extractSportsbet(event: OddsApiEvent): SportsbetEventOdds | null {
  const book = event.bookmakers?.find((b) => b.key === BOOKMAKER);
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
        link: outcome.link ?? book.link,
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

const FEATURED_MARKETS = "h2h,spreads,totals";
const PROP_MARKETS = [
  "player_goal_scorer_anytime",
  "player_goals_scored_over",
  "player_disposals",
  "player_disposals_over",
  "player_tackles_over",
  "player_marks_over",
].join(",");

export async function fetchSportsbetFeaturedOdds(): Promise<{
  events: SportsbetEventOdds[];
  remaining: number | null;
}> {
  const { data, remaining } = await oddsFetch(
    `/sports/${SPORT}/odds?regions=au&bookmakers=${BOOKMAKER}&markets=${FEATURED_MARKETS}&oddsFormat=decimal`,
  );
  const events = (data as OddsApiEvent[])
    .map(extractSportsbet)
    .filter((e): e is SportsbetEventOdds => e !== null);
  return { events, remaining };
}

export async function fetchSportsbetEventProps(
  eventId: string,
): Promise<SportsbetEventOdds | null> {
  const { data } = await oddsFetch(
    `/sports/${SPORT}/events/${eventId}/odds?regions=au&bookmakers=${BOOKMAKER}&markets=${PROP_MARKETS}&oddsFormat=decimal`,
  );
  return extractSportsbet(data as OddsApiEvent);
}

export async function loadSportsbetBoard(matchups: {
  homeTeam: string;
  awayTeam: string;
}[]): Promise<{
  byMatchup: Map<string, SportsbetEventOdds>;
  status: SportsbetStatus;
}> {
  const byMatchup = new Map<string, SportsbetEventOdds>();
  const baseStatus = getSportsbetConfigStatus();
  if (!baseStatus.configured) {
    return { byMatchup, status: baseStatus };
  }

  try {
    const { events, remaining } = await fetchSportsbetFeaturedOdds();

    // Match fixtures and pull props for overlapping games (cap to save credits)
    const matched: SportsbetEventOdds[] = [];
    for (const m of matchups) {
      const hit = events.find((e) =>
        teamNamesCompatible(m.homeTeam, m.awayTeam, e.homeTeam, e.awayTeam),
      );
      if (hit) matched.push(hit);
    }

    const limited = matched.slice(0, 6);
    await Promise.all(
      limited.map(async (ev) => {
        try {
          const props = await fetchSportsbetEventProps(ev.eventId);
          if (props) {
            // merge featured + props lines
            const merged: SportsbetEventOdds = {
              ...ev,
              lines: [...ev.lines, ...props.lines],
              lastUpdate: props.lastUpdate ?? ev.lastUpdate,
              eventLink: props.eventLink ?? ev.eventLink,
            };
            byMatchup.set(
              `${normalizeName(ev.homeTeam)}|${normalizeName(ev.awayTeam)}`,
              merged,
            );
            byMatchup.set(
              `${normalizeName(ev.awayTeam)}|${normalizeName(ev.homeTeam)}`,
              merged,
            );
          } else {
            byMatchup.set(
              `${normalizeName(ev.homeTeam)}|${normalizeName(ev.awayTeam)}`,
              ev,
            );
          }
        } catch {
          byMatchup.set(
            `${normalizeName(ev.homeTeam)}|${normalizeName(ev.awayTeam)}`,
            ev,
          );
        }
      }),
    );

    return {
      byMatchup,
      status: {
        configured: true,
        connected: true,
        message:
          byMatchup.size > 0
            ? `Sportsbet prices linked for ${limited.length} fixture${limited.length === 1 ? "" : "s"}.`
            : "Connected, but no Sportsbet markets matched this slate yet.",
        remainingRequests: remaining,
      },
    };
  } catch (err) {
    return {
      byMatchup,
      status: {
        configured: true,
        connected: false,
        message: "Sportsbet link failed — using Bounce model odds.",
        lastError: err instanceof Error ? err.message : "Unknown error",
      },
    };
  }
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
): CandidateLeg[] {
  if (!board) return legs;

  return legs.map((leg) => {
    const line = findSportsbetLine(board, leg);
    if (!line) return leg;

    const sportsbetOdds = roundOdds(line.price);
    const impliedProb = 1 / Math.max(sportsbetOdds, 1.01);
    const selection = formatSportsbetSelection(line, leg);
    const vsModel = valueScore(leg.probability, sportsbetOdds);

    return {
      ...leg,
      odds: sportsbetOdds,
      modelOdds: leg.odds,
      sportsbetOdds,
      sportsbetMarket: line.marketKey,
      sportsbetLink: line.link ?? board.eventLink,
      sportsbetPoint: line.point,
      sportsbetSelection: selection,
      valueScore: vsModel,
      factors: [
        ...leg.factors,
        {
          key: "sportsbet",
          label: "Sportsbet",
          impact:
            sportsbetOdds > (leg.modelOdds ?? leg.odds) * 1.05
              ? "positive"
              : sportsbetOdds < (leg.modelOdds ?? leg.odds) * 0.95
                ? "negative"
                : "neutral",
          detail: `Live Sportsbet ${selection} @ $${sportsbetOdds.toFixed(2)} (model ~$${(leg.modelOdds ?? leg.odds).toFixed(2)}, implied ${(impliedProb * 100).toFixed(0)}%)`,
          weight: 0,
        },
      ],
    };
  });
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
  return (
    map.get(`${normalizeName(homeTeam)}|${normalizeName(awayTeam)}`) ??
    map.get(`${normalizeName(awayTeam)}|${normalizeName(homeTeam)}`)
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

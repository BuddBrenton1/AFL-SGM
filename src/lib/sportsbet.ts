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

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/magpies|blues|bombers|dockers|cats|suns|giants|hawks|demons|kangaroos|power|tigers|saints|swans|eagles|bulldogs|lions|crows/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const aParts = na.split(" ");
  const bParts = nb.split(" ");
  // surname match for players
  if (aParts.length >= 2 && bParts.length >= 2) {
    return aParts[aParts.length - 1] === bParts[bParts.length - 1] &&
      aParts[0][0] === bParts[0][0];
  }
  return false;
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
    (namesMatch(homeA, homeB) && namesMatch(awayA, awayB)) ||
    (namesMatch(homeA, awayB) && namesMatch(awayA, homeB))
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
    return (
      lines.find(
        (l) =>
          l.marketKey === "h2h" &&
          namesMatch(l.name, leg.label.replace(/ Win$/, "")),
      ) ?? null
    );
  }

  if (leg.market === "total_points" && leg.threshold != null) {
    return (
      lines.find(
        (l) =>
          l.marketKey === "totals" &&
          l.name.toLowerCase() === "over" &&
          l.point != null &&
          Math.abs(l.point - leg.threshold!) < 0.2,
      ) ??
      lines.find((l) => l.marketKey === "totals" && l.name.toLowerCase() === "over") ??
      null
    );
  }

  if (!leg.playerName) return null;

  if (leg.market === "player_goal") {
    if (leg.threshold === 1) {
      return (
        lines.find(
          (l) =>
            l.marketKey === "player_goal_scorer_anytime" &&
            l.description &&
            namesMatch(l.description, leg.playerName!),
        ) ?? null
      );
    }
    const targetPoint = (leg.threshold ?? 2) - 0.5; // 2+ ≈ over 1.5
    const overs = lines.filter(
      (l) =>
        l.marketKey === "player_goals_scored_over" &&
        l.description &&
        namesMatch(l.description, leg.playerName!) &&
        l.name.toLowerCase() === "over",
    );
    return (
      overs.find((l) => l.point != null && Math.abs(l.point - targetPoint) < 0.2) ??
      overs.find((l) => l.point != null && l.point <= targetPoint + 0.6) ??
      null
    );
  }

  if (leg.market === "player_disposal" && leg.threshold != null) {
    const target = leg.threshold - 0.5;
    const overs = lines.filter(
      (l) =>
        (l.marketKey === "player_disposals" || l.marketKey === "player_disposals_over") &&
        l.description &&
        namesMatch(l.description, leg.playerName!) &&
        l.name.toLowerCase() === "over",
    );
    return (
      overs.find((l) => l.point != null && Math.abs(l.point - target) < 0.2) ??
      overs.find((l) => l.point != null && Math.abs(l.point - leg.threshold!) < 0.6) ??
      null
    );
  }

  if (leg.market === "player_tackle" && leg.threshold != null) {
    const target = leg.threshold - 0.5;
    const overs = lines.filter(
      (l) =>
        l.marketKey === "player_tackles_over" &&
        l.description &&
        namesMatch(l.description, leg.playerName!) &&
        l.name.toLowerCase() === "over",
    );
    return (
      overs.find((l) => l.point != null && Math.abs(l.point - target) < 0.2) ??
      overs[0] ??
      null
    );
  }

  if (leg.market === "player_mark" && leg.threshold != null) {
    const overs = lines.filter(
      (l) =>
        l.marketKey === "player_marks_over" &&
        l.description &&
        namesMatch(l.description, leg.playerName!),
    );
    return overs[0] ?? null;
  }

  return null;
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
    // Prefer Sportsbet price for display/combo; keep model probability for confidence
    const vsModel = valueScore(leg.probability, sportsbetOdds);

    return {
      ...leg,
      odds: sportsbetOdds,
      modelOdds: leg.odds,
      sportsbetOdds,
      sportsbetMarket: line.marketKey as string,
      sportsbetLink: line.link ?? board.eventLink,
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
          detail: `Live Sportsbet ${sportsbetOdds.toFixed(2)} (model ~${(leg.modelOdds ?? leg.odds).toFixed(2)}, implied ${(impliedProb * 100).toFixed(0)}%)`,
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

import type { MarketType, SgmMulti, TeamId } from "./types";

export type LegOutcome = "pending" | "won" | "lost" | "void";
export type MultiOutcome = "pending" | "open" | "won" | "lost" | "needs_stats";

export interface SavedLegSnapshot {
  id: string;
  market: MarketType;
  label: string;
  shortLabel: string;
  playerName?: string;
  teamId?: TeamId;
  threshold?: number;
  odds: number;
  sportsbetOdds?: number;
  confidence: number;
}

export interface SavedLegResult {
  legId: string;
  outcome: LegOutcome;
  /** Actual stat entered (goals / disposals / tackles / marks / total points) */
  actual?: number;
  settledAt?: string;
  settledBy?: "auto" | "manual";
  note?: string;
}

export interface SavedGameStatus {
  complete: number;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  winner?: string;
  lastCheckedAt?: string;
}

export interface SavedSgm {
  id: string;
  savedAt: string;
  bookmaker?: string;
  bookmakerLabel?: string;
  multiId: string;
  gameId: number;
  matchup: string;
  venue: string;
  round: number;
  combinedOdds: number;
  confidence: number;
  sportsbetCombinedOdds?: number | null;
  sportsbetLink?: string;
  legs: SavedLegSnapshot[];
  gameStatus: SavedGameStatus;
  legResults: SavedLegResult[];
  multiOutcome: MultiOutcome;
}

const STORAGE_KEY = "bounce.savedSgms.v1";

function parseMatchup(matchup: string): { homeTeam: string; awayTeam: string } {
  const parts = matchup.split(/\s+vs\s+/i);
  return {
    homeTeam: parts[0]?.trim() || "Home",
    awayTeam: parts[1]?.trim() || "Away",
  };
}

export function createSavedSgm(
  multi: SgmMulti,
  opts?: { bookmaker?: string; bookmakerLabel?: string },
): SavedSgm {
  const { homeTeam, awayTeam } = parseMatchup(multi.matchup);
  return {
    id: `sgm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    bookmaker: opts?.bookmaker,
    bookmakerLabel: opts?.bookmakerLabel,
    multiId: multi.id,
    gameId: multi.gameId,
    matchup: multi.matchup,
    venue: multi.venue,
    round: multi.round,
    combinedOdds: multi.combinedOdds,
    confidence: multi.confidence,
    sportsbetCombinedOdds: multi.sportsbetCombinedOdds,
    sportsbetLink: multi.sportsbetLink,
    legs: multi.legs.map((l) => ({
      id: l.id,
      market: l.market,
      label: l.label,
      shortLabel: l.shortLabel,
      playerName: l.playerName,
      teamId: l.teamId,
      threshold: l.threshold,
      odds: l.odds,
      sportsbetOdds: l.sportsbetOdds,
      confidence: l.confidence,
    })),
    gameStatus: {
      complete: 0,
      homeTeam,
      awayTeam,
    },
    legResults: multi.legs.map((l) => ({
      legId: l.id,
      outcome: "pending" as const,
    })),
    multiOutcome: "pending",
  };
}

export function loadSavedSgms(): SavedSgm[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedSgm[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistSavedSgms(items: SavedSgm[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function upsertSavedSgm(item: SavedSgm, list: SavedSgm[]): SavedSgm[] {
  const next = [item, ...list.filter((x) => x.id !== item.id)];
  persistSavedSgms(next);
  return next;
}

export function removeSavedSgm(id: string, list: SavedSgm[]): SavedSgm[] {
  const next = list.filter((x) => x.id !== id);
  persistSavedSgms(next);
  return next;
}

export function isPlayerMarket(market: MarketType): boolean {
  return (
    market === "player_goal" ||
    market === "player_disposal" ||
    market === "player_mark" ||
    market === "player_tackle"
  );
}

export function deriveMultiOutcome(item: SavedSgm): MultiOutcome {
  const outcomes = item.legResults.map((r) => r.outcome);
  if (outcomes.some((o) => o === "lost")) return "lost";
  if (outcomes.every((o) => o === "won" || o === "void")) {
    return outcomes.some((o) => o === "won") ? "won" : "pending";
  }
  if (item.gameStatus.complete >= 100 && outcomes.some((o) => o === "pending")) {
    return "needs_stats";
  }
  if (item.gameStatus.complete > 0) return "open";
  return "pending";
}

export function applyLegResults(
  item: SavedSgm,
  updates: SavedLegResult[],
): SavedSgm {
  const byId = new Map(item.legResults.map((r) => [r.legId, r]));
  for (const u of updates) byId.set(u.legId, { ...byId.get(u.legId), ...u });
  const next: SavedSgm = {
    ...item,
    legResults: item.legs.map(
      (l) => byId.get(l.id) ?? { legId: l.id, outcome: "pending" },
    ),
  };
  next.multiOutcome = deriveMultiOutcome(next);
  return next;
}

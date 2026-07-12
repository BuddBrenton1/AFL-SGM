import type {
  SavedGameStatus,
  SavedLegResult,
  SavedLegSnapshot,
  SavedSgm,
} from "./saved-sgm";
import { applyLegResults, isPlayerMarket } from "./saved-sgm";

export interface GameResultPayload {
  id: number;
  complete: number;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  winner?: string;
  round: number;
  venue: string;
  date: string;
}

function teamsMatch(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nb = b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function settleMatchResult(
  leg: SavedLegSnapshot,
  game: GameResultPayload,
): SavedLegResult | null {
  if (leg.market !== "match_result" || game.complete < 100 || !game.winner) {
    return null;
  }
  const tipped = leg.label.replace(/\s+Win$/i, "").trim();
  const won = teamsMatch(tipped, game.winner);
  return {
    legId: leg.id,
    outcome: won ? "won" : "lost",
    settledAt: new Date().toISOString(),
    settledBy: "auto",
    note: `FT ${game.homeTeam} ${game.homeScore} – ${game.awayScore} ${game.awayTeam}`,
  };
}

function settleTotalPoints(
  leg: SavedLegSnapshot,
  game: GameResultPayload,
): SavedLegResult | null {
  if (leg.market !== "total_points" || game.complete < 100) return null;
  if (leg.threshold == null || game.homeScore == null || game.awayScore == null) {
    return null;
  }
  const total = game.homeScore + game.awayScore;
  const over = /over/i.test(leg.label) || !/under/i.test(leg.label);
  const hit = over ? total >= leg.threshold : total <= leg.threshold;
  return {
    legId: leg.id,
    outcome: hit ? "won" : "lost",
    actual: total,
    settledAt: new Date().toISOString(),
    settledBy: "auto",
    note: `Match total ${total}`,
  };
}

function settleLine(
  leg: SavedLegSnapshot,
  game: GameResultPayload,
): SavedLegResult | null {
  if (leg.market !== "line" || game.complete < 100) return null;
  // Line markets are rare in current scanner; leave pending unless we can infer
  return null;
}

/** Auto-settle match winner + totals from Squiggle FT score. */
export function autoSettleFromGame(
  item: SavedSgm,
  game: GameResultPayload,
): SavedSgm {
  const gameStatus: SavedGameStatus = {
    complete: game.complete,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    winner: game.winner,
    lastCheckedAt: new Date().toISOString(),
  };

  const updates: SavedLegResult[] = [];
  for (const leg of item.legs) {
    const existing = item.legResults.find((r) => r.legId === leg.id);
    if (existing && existing.outcome !== "pending" && existing.settledBy === "manual") {
      continue;
    }
    const hit =
      settleMatchResult(leg, game) ??
      settleTotalPoints(leg, game) ??
      settleLine(leg, game);
    if (hit) updates.push(hit);
  }

  const next = applyLegResults(
    { ...item, gameStatus },
    updates,
  );
  return next;
}

/** Settle a player prop from an entered actual stat. */
export function settlePlayerLeg(
  item: SavedSgm,
  legId: string,
  actual: number,
): SavedSgm {
  const leg = item.legs.find((l) => l.id === legId);
  if (!leg || !isPlayerMarket(leg.market) || leg.threshold == null) return item;
  const hit = actual >= leg.threshold;
  return applyLegResults(item, [
    {
      legId,
      outcome: hit ? "won" : "lost",
      actual,
      settledAt: new Date().toISOString(),
      settledBy: "manual",
      note: `${leg.playerName ?? "Player"} finished with ${actual}`,
    },
  ]);
}

export function markLegOutcome(
  item: SavedSgm,
  legId: string,
  outcome: "won" | "lost",
): SavedSgm {
  return applyLegResults(item, [
    {
      legId,
      outcome,
      settledAt: new Date().toISOString(),
      settledBy: "manual",
    },
  ]);
}

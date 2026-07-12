import {
  findPlayerLine,
  type EspnMatchBox,
  type EspnPlayerLine,
} from "./espn-stats";
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
  espnEventId?: string | null;
  players?: EspnPlayerLine[];
  espnStatusText?: string;
  espnCompleted?: boolean;
  espnInProgress?: boolean;
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
  if (leg.market !== "match_result") return null;
  // Only lock match result at full time
  if (game.complete < 100 && !game.espnCompleted) return null;
  const winner =
    game.winner ||
    (game.homeScore != null &&
    game.awayScore != null &&
    game.homeScore !== game.awayScore
      ? game.homeScore > game.awayScore
        ? game.homeTeam
        : game.awayTeam
      : undefined);
  if (!winner) return null;
  const tipped = leg.label.replace(/\s+Win$/i, "").trim();
  const won = teamsMatch(tipped, winner);
  return {
    legId: leg.id,
    outcome: won ? "won" : "lost",
    settledAt: new Date().toISOString(),
    settledBy: "auto",
    note: `FT ${game.homeTeam} ${game.homeScore ?? "–"} – ${game.awayScore ?? "–"} ${game.awayTeam}`,
  };
}

function settleTotalPoints(
  leg: SavedLegSnapshot,
  game: GameResultPayload,
): SavedLegResult | null {
  if (leg.market !== "total_points") return null;
  if (game.complete < 100 && !game.espnCompleted) return null;
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

function statForMarket(
  line: EspnPlayerLine,
  market: SavedLegSnapshot["market"],
): number | null {
  switch (market) {
    case "player_goal":
      return line.goals;
    case "player_disposal":
      return line.disposals;
    case "player_tackle":
      return line.tackles;
    case "player_mark":
      return line.marks;
    default:
      return null;
  }
}

/**
 * Live/auto player prop settlement from ESPN box score.
 * - Scratched / unused emergency (no involvement) → void (SGM refunds)
 * - Threshold reached → won immediately (even in-play)
 * - Game finished and under threshold → lost
 * - Still in play and under → pending with live actual / bench warning
 */
function settlePlayerFromBox(
  leg: SavedLegSnapshot,
  game: GameResultPayload,
): SavedLegResult | null {
  if (!isPlayerMarket(leg.market) || !leg.playerName || leg.threshold == null) {
    return null;
  }
  if (!game.players?.length) return null;

  const finished = game.espnCompleted || game.complete >= 100;
  const lateInGame =
    finished ||
    game.complete >= 50 ||
    /q3|q4|third|fourth|3rd|4th|half.?time|final/i.test(
      game.espnStatusText ?? "",
    );

  const line = findPlayerLine(game.players, leg.playerName);
  if (!line) {
    // Missing from a populated box at FT → scratched / not named → void
    if (finished && game.players.length >= 30) {
      return {
        legId: leg.id,
        outcome: "void",
        actual: 0,
        settledAt: new Date().toISOString(),
        settledBy: "auto",
        note: `${leg.playerName} not in box score — treated as scratched (SGM void)`,
      };
    }
    if (lateInGame && game.players.length >= 30) {
      return {
        legId: leg.id,
        outcome: "pending",
        actual: 0,
        settledBy: "auto",
        note: `${leg.playerName} not on live sheet yet — possible scratch`,
      };
    }
    return null;
  }

  // Unused emergency / never took the field (all counting stats zero)
  if (line.didNotPlay) {
    if (finished) {
      return {
        legId: leg.id,
        outcome: "void",
        actual: 0,
        settledAt: new Date().toISOString(),
        settledBy: "auto",
        note: `${leg.playerName} recorded no involvement — unused/DNP (SGM void)`,
      };
    }
    if (lateInGame) {
      return {
        legId: leg.id,
        outcome: "pending",
        actual: 0,
        settledBy: "auto",
        note: `${leg.playerName}: still 0 involvement — likely benched/emergency`,
      };
    }
    return {
      legId: leg.id,
      outcome: "pending",
      actual: 0,
      settledBy: "auto",
      note: `Live ${leg.playerName}: 0 / ${leg.threshold}+`,
    };
  }

  const actual = statForMarket(line, leg.market);
  if (actual == null) return null;

  if (actual >= leg.threshold) {
    return {
      legId: leg.id,
      outcome: "won",
      actual,
      settledAt: new Date().toISOString(),
      settledBy: "auto",
      note: `Live ${leg.playerName}: ${actual} (need ${leg.threshold}+)`,
    };
  }

  if (finished) {
    return {
      legId: leg.id,
      outcome: "lost",
      actual,
      settledAt: new Date().toISOString(),
      settledBy: "auto",
      note: `FT ${leg.playerName}: ${actual} (needed ${leg.threshold}+)`,
    };
  }

  // Low-involvement warning (proxy for limited minutes — ESPN has no TOG %)
  const lowMinutes =
    lateInGame && line.involvement > 0 && line.involvement <= 4;
  return {
    legId: leg.id,
    outcome: "pending",
    actual,
    settledBy: "auto",
    note: lowMinutes
      ? `Live ${leg.playerName}: ${actual}/${leg.threshold}+ · low involvement (${line.involvement}) — likely limited minutes`
      : `Live ${leg.playerName}: ${actual} / ${leg.threshold}+`,
  };
}

/** Auto-settle from Squiggle FT + ESPN live player box. */
export function autoSettleFromGame(
  item: SavedSgm,
  game: GameResultPayload,
): SavedSgm {
  const complete =
    game.espnCompleted || game.complete >= 100
      ? 100
      : game.espnInProgress
        ? Math.max(game.complete, 1)
        : game.complete;

  const gameStatus: SavedGameStatus = {
    complete,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    winner: game.winner,
    lastCheckedAt: new Date().toISOString(),
    espnEventId: game.espnEventId ?? item.gameStatus.espnEventId,
    espnStatusText: game.espnStatusText,
  };

  const updates: SavedLegResult[] = [];
  for (const leg of item.legs) {
    const existing = item.legResults.find((r) => r.legId === leg.id);
    // Never reopen a locked won/lost/void
    if (
      existing &&
      (existing.outcome === "won" ||
        existing.outcome === "lost" ||
        existing.outcome === "void")
    ) {
      continue;
    }

    const hit =
      settlePlayerFromBox(leg, game) ??
      settleMatchResult(leg, game) ??
      settleTotalPoints(leg, game);
    if (hit) updates.push(hit);
  }

  return applyLegResults({ ...item, gameStatus }, updates);
}

/** Merge ESPN box into a Squiggle game payload. */
export function mergeEspnBox(
  game: GameResultPayload,
  box: EspnMatchBox | null,
): GameResultPayload {
  if (!box) return game;
  return {
    ...game,
    espnEventId: box.eventId,
    players: box.players,
    espnStatusText: box.statusText,
    espnCompleted: box.completed,
    espnInProgress: box.inProgress,
    homeScore: box.homeScore ?? game.homeScore,
    awayScore: box.awayScore ?? game.awayScore,
    winner: box.completed
      ? box.homeScore != null &&
        box.awayScore != null &&
        box.homeScore !== box.awayScore
        ? box.homeScore > box.awayScore
          ? box.homeTeam
          : box.awayTeam
        : game.winner
      : game.winner,
    complete: box.completed ? 100 : game.complete,
  };
}

import type {
  CandidateLeg,
  EnrichedGame,
  MarketType,
  PlayerProfile,
  PlayerSeasonForm,
  SgmMulti,
} from "../types";
import { composeSgmMulti, legPrice } from "./scanner";

export const BEST_FORM_GAMES = 5;
export const BEST_FORM_MIN_GAMES = 4;

function recentValues(
  form: PlayerSeasonForm,
  market: MarketType,
): number[] {
  switch (market) {
    case "player_goal":
      return form.last5Goals;
    case "player_disposal":
      return form.last5Disposals;
    case "player_mark":
      return form.last5Marks;
    case "player_tackle":
      return form.last5Tackles;
    default:
      return [];
  }
}

/** True if the player cleared the threshold in every one of the last N games. */
export function hitEveryRecentGame(
  values: number[],
  threshold: number,
  n: number = BEST_FORM_GAMES,
): { ok: boolean; games: number; values: number[] } {
  const slice = values.slice(-Math.max(n, BEST_FORM_MIN_GAMES));
  const useN =
    values.length >= n
      ? n
      : values.length >= BEST_FORM_MIN_GAMES
        ? BEST_FORM_MIN_GAMES
        : 0;
  if (useN < BEST_FORM_MIN_GAMES) {
    return { ok: false, games: values.length, values: slice };
  }
  const window = values.slice(-useN);
  return {
    ok: window.every((v) => v >= threshold),
    games: window.length,
    values: window,
  };
}

export function isPlayerPropMarket(market: MarketType): boolean {
  return (
    market === "player_goal" ||
    market === "player_disposal" ||
    market === "player_mark" ||
    market === "player_tackle"
  );
}

function findPlayer(
  leg: CandidateLeg,
  game: EnrichedGame,
): PlayerProfile | undefined {
  if (!leg.playerId) return undefined;
  return (
    game.homePlayers.find((p) => p.id === leg.playerId) ??
    game.awayPlayers.find((p) => p.id === leg.playerId)
  );
}

/**
 * Player props available on the book that the athlete has cleared in
 * every recent game (last 4–5). Prefers the highest threshold still
 * sitting at 100% recent form for each player+market.
 */
export function collectBestFormLegs(
  legs: CandidateLeg[],
  game: EnrichedGame,
  opts?: { requireSportsbet?: boolean },
): CandidateLeg[] {
  const requireSb = opts?.requireSportsbet !== false;
  const locks: CandidateLeg[] = [];

  for (const leg of legs) {
    if (!isPlayerPropMarket(leg.market)) continue;
    if (leg.threshold == null || !leg.playerId) continue;
    if (requireSb && leg.sportsbetOdds == null) continue;

    const player = findPlayer(leg, game);
    if (!player) continue;
    // Inferred mark lines are noisy — only keep explicit mark form
    if (leg.market === "player_mark" && !player.marksExplicit) continue;

    const recent = recentValues(player.form, leg.market);
    const hit = hitEveryRecentGame(recent, leg.threshold, BEST_FORM_GAMES);
    if (!hit.ok) continue;

    const annotated: CandidateLeg = {
      ...leg,
      factors: [
        ...leg.factors,
        {
          key: "best-form",
          label: "Recent form",
          impact: "positive",
          detail: `Hit ${leg.threshold}+ in all last ${hit.games} games (${hit.values.join(", ")})`,
          weight: 0.05,
        },
      ],
    };
    locks.push(annotated);
  }

  // One leg per player+market — keep the toughest threshold still at 100%
  const byKey = new Map<string, CandidateLeg>();
  for (const leg of locks) {
    const key = `${leg.playerId}:${leg.market}`;
    const prev = byKey.get(key);
    if (!prev || (leg.threshold ?? 0) > (prev.threshold ?? 0)) {
      byKey.set(key, leg);
    }
  }

  return [...byKey.values()].sort(
    (a, b) =>
      legPrice(a) - legPrice(b) ||
      b.confidence - a.confidence ||
      (b.threshold ?? 0) - (a.threshold ?? 0),
  );
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickRandomLegCount(available: number): number {
  if (available < 2) return available;
  const maxLegs = Math.min(8, available);
  const minLegs = Math.min(3, maxLegs);
  return minLegs + Math.floor(Math.random() * (maxLegs - minLegs + 1));
}

/** Avoid stacking the same player twice in a BEST multi. */
function canAddBest(picked: CandidateLeg[], cand: CandidateLeg): boolean {
  if (picked.some((l) => l.playerId && l.playerId === cand.playerId)) {
    return false;
  }
  if (picked.some((l) => l.id === cand.id)) return false;
  return true;
}

/**
 * One "BEST" SGM per game: Sportsbet-viewable player props with 100%
 * recent form, and a random leg count from the lock pool.
 */
export function buildBestFormMulti(opts: {
  game: EnrichedGame;
  legs: CandidateLeg[];
  sportsbetLink?: string;
  bookmakerLabel?: string;
  requireSportsbet?: boolean;
}): SgmMulti | null {
  const pool = collectBestFormLegs(opts.legs, opts.game, {
    requireSportsbet: opts.requireSportsbet,
  });
  if (pool.length < 2) return null;

  const n = pickRandomLegCount(pool.length);
  const ordered = shuffle(pool);
  const picked: CandidateLeg[] = [];
  for (const cand of ordered) {
    if (picked.length >= n) break;
    if (!canAddBest(picked, cand)) continue;
    picked.push(cand);
  }
  // Fill from sorted pool if shuffle left gaps (same-player conflicts)
  if (picked.length < Math.min(2, n)) {
    for (const cand of pool) {
      if (picked.length >= n) break;
      if (!canAddBest(picked, cand)) continue;
      picked.push(cand);
    }
  }
  if (picked.length < 2) return null;

  const multi = composeSgmMulti(
    {
      gameId: opts.game.id,
      matchup: `${opts.game.homeTeam} vs ${opts.game.awayTeam}`,
      venue: opts.game.venue,
      round: opts.game.round,
      sportsbetLink: opts.sportsbetLink,
      bookmakerLabel: opts.bookmakerLabel,
    },
    picked,
  );

  multi.id = `best:${multi.id}`;
  multi.rationale = [
    `BEST · ${picked.length} legs · each hit in all last ${BEST_FORM_MIN_GAMES}–${BEST_FORM_GAMES} games`,
    opts.requireSportsbet !== false
      ? `Live ${opts.bookmakerLabel ?? "book"} player props only`
      : "Player props (book prices when matched)",
    ...multi.rationale.filter((r) => !r.startsWith("BEST ·")),
  ];
  multi.edgeScore += 0.15;
  return multi;
}

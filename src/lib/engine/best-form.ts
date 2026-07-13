import type {
  CandidateLeg,
  EnrichedGame,
  MarketType,
  PlayerProfile,
  SgmMulti,
} from "../types";
import type { LiveFormLine } from "../live-form";
import { composeSgmMulti, legPrice } from "./scanner";

export const BEST_FORM_GAMES = 5;
/** BEST locks need a full last-5 — partial windows hide recent misses. */
export const BEST_FORM_MIN_GAMES = 5;
/** Fallback only when the user hasn't set a max leg price. */
export const BEST_MAX_LEG_PRICE = 1.4;
/** Recent-form hit-rate floor (must be 100% of last-5). */
export const BEST_MIN_RECENT_HIT_RATE = 1;

function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ap = na.split(" ").filter(Boolean);
  const bp = nb.split(" ").filter(Boolean);
  if (ap.length < 2 || bp.length < 2) return false;
  const aLast = ap[ap.length - 1];
  const bLast = bp[bp.length - 1];
  const aFirst = ap[0];
  const bFirst = bp[0];
  if (aFirst === bFirst && aLast === bLast) return true;
  if (aLast === bLast && aFirst[0] === bFirst[0]) return true;
  return false;
}

function recentValuesForMarket(
  line: LiveFormLine,
  market: MarketType,
): number[] {
  switch (market) {
    case "player_goal":
      return line.last5Goals;
    case "player_disposal":
      return line.last5Disposals;
    case "player_mark":
      return line.last5Marks;
    case "player_tackle":
      return line.last5Tackles;
    default:
      return [];
  }
}

function formValuesForMarket(
  player: PlayerProfile,
  market: MarketType,
): number[] {
  switch (market) {
    case "player_goal":
      return player.form.last5Goals;
    case "player_disposal":
      return player.form.last5Disposals;
    case "player_mark":
      return player.form.last5Marks;
    case "player_tackle":
      return player.form.last5Tackles;
    default:
      return [];
  }
}

/** True if the player cleared the threshold in every one of the last N games. */
export function hitEveryRecentGame(
  values: number[],
  threshold: number,
  n: number = BEST_FORM_GAMES,
): { ok: boolean; games: number; hits: number; values: number[]; rate: number } {
  if (values.length < BEST_FORM_MIN_GAMES) {
    return {
      ok: false,
      games: values.length,
      hits: 0,
      values: values.slice(-n),
      rate: 0,
    };
  }
  const window = values.slice(-Math.max(n, BEST_FORM_MIN_GAMES));
  if (window.length < BEST_FORM_MIN_GAMES) {
    return { ok: false, games: window.length, hits: 0, values: window, rate: 0 };
  }
  const hits = window.filter((v) => Number(v) >= threshold).length;
  const rate = hits / window.length;
  return {
    ok: hits === window.length && rate >= BEST_MIN_RECENT_HIT_RATE - 1e-9,
    games: window.length,
    hits,
    values: window,
    rate,
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
  if (leg.playerId) {
    const byId =
      game.homePlayers.find((p) => p.id === leg.playerId) ??
      game.awayPlayers.find((p) => p.id === leg.playerId);
    if (byId) return byId;
  }
  const name = leg.playerName ?? leg.label;
  if (!name) return undefined;
  return (
    game.homePlayers.find((p) => namesMatch(p.name, name)) ??
    game.awayPlayers.find((p) => namesMatch(p.name, name))
  );
}

function lookupLiveForm(
  liveByName: Map<string, LiveFormLine> | undefined,
  player: PlayerProfile,
  leg: CandidateLeg,
): LiveFormLine | undefined {
  if (!liveByName?.size) return undefined;
  const keys = [player.name, leg.playerName].filter(Boolean) as string[];
  for (const key of keys) {
    const direct = liveByName.get(normalizePersonName(key));
    if (direct && direct.games >= BEST_FORM_MIN_GAMES) return direct;
  }
  for (const key of keys) {
    const found = [...liveByName.values()].find((l) => namesMatch(l.name, key));
    if (found && found.games >= BEST_FORM_MIN_GAMES) return found;
  }
  return undefined;
}

/**
 * Resolve the numeric clear-line for a prop.
 * Over 13.5 → threshold 14 (must finish with ≥ 14).
 */
function resolveClearLine(leg: CandidateLeg): number | null {
  if (leg.threshold != null && Number.isFinite(leg.threshold)) {
    return leg.threshold;
  }
  if (leg.sportsbetPoint != null && Number.isFinite(leg.sportsbetPoint)) {
    const p = leg.sportsbetPoint;
    return Number.isInteger(p) ? p : Math.ceil(p);
  }
  return null;
}

/**
 * Player props available on the book that the athlete has cleared in
 * every recent game (last 5). Prefers the highest threshold still
 * sitting at 100% recent form for each player+market.
 */
export function collectBestFormLegs(
  legs: CandidateLeg[],
  game: EnrichedGame,
  opts?: {
    requireSportsbet?: boolean;
    /** User's max per-leg price — required for BEST to respect the scanner control */
    maxLegPrice?: number;
    liveByName?: Map<string, LiveFormLine>;
  },
): CandidateLeg[] {
  const requireSb = opts?.requireSportsbet !== false;
  const maxPrice = Math.min(
    BEST_MAX_LEG_PRICE,
    Math.max(1.01, opts?.maxLegPrice ?? BEST_MAX_LEG_PRICE),
  );
  const locks: CandidateLeg[] = [];

  for (const leg of legs) {
    if (!isPlayerPropMarket(leg.market)) continue;
    if (requireSb && leg.sportsbetOdds == null) continue;

    const price = legPrice(leg);
    if (!(price <= maxPrice + 1e-9)) continue;

    const clearLine = resolveClearLine(leg);
    if (clearLine == null) continue;

    const player = findPlayer(leg, game);
    if (!player) continue;
    if (leg.market === "player_mark" && !player.marksExplicit && player.formSource !== "espn") {
      continue;
    }
    if (leg.market === "player_tackle" && !player.tacklesExplicit && player.formSource !== "espn") {
      continue;
    }

    // Prefer raw ESPN line by name — don't trust seed even if formSource was missed
    const live = lookupLiveForm(opts?.liveByName, player, leg);
    if (!live) continue; // no ESPN row → not a BEST lock

    const recent = recentValuesForMarket(live, leg.market);
    const hit = hitEveryRecentGame(recent, clearLine, BEST_FORM_GAMES);
    if (!hit.ok) continue;

    // Double-check against player profile if ESPN-tagged (paranoia)
    if (player.formSource === "espn") {
      const profileHit = hitEveryRecentGame(
        formValuesForMarket(player, leg.market),
        clearLine,
        BEST_FORM_GAMES,
      );
      if (!profileHit.ok) continue;
    }

    const annotated: CandidateLeg = {
      ...leg,
      playerId: player.id,
      playerName: player.name,
      threshold: clearLine,
      factors: [
        ...leg.factors.filter((f) => f.key !== "best-form"),
        {
          key: "best-form",
          label: "Recent form",
          impact: "positive",
          detail: `L${hit.games} ${hit.hits}/${hit.games} · ${clearLine}+ every game [${hit.values.join(", ")}] · ESPN · ≤$${maxPrice.toFixed(2)}`,
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
  maxLegPrice?: number;
  liveByName?: Map<string, LiveFormLine>;
}): SgmMulti | null {
  const maxPrice = Math.min(
    BEST_MAX_LEG_PRICE,
    Math.max(1.01, opts.maxLegPrice ?? BEST_MAX_LEG_PRICE),
  );
  const pool = collectBestFormLegs(opts.legs, opts.game, {
    requireSportsbet: opts.requireSportsbet,
    maxLegPrice: maxPrice,
    liveByName: opts.liveByName,
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
  if (picked.length < Math.min(2, n)) {
    for (const cand of pool) {
      if (picked.length >= n) break;
      if (!canAddBest(picked, cand)) continue;
      picked.push(cand);
    }
  }
  if (picked.length < 2) return null;

  // Final hard filter — never ship a leg over the user's max or under 100% ESPN form
  const clean = picked.filter((leg) => {
    if (legPrice(leg) > maxPrice + 1e-9) return false;
    const clearLine = resolveClearLine(leg);
    if (clearLine == null) return false;
    const player = findPlayer(leg, opts.game);
    if (!player) return false;
    const live = lookupLiveForm(opts.liveByName, player, leg);
    if (!live) return false;
    return hitEveryRecentGame(
      recentValuesForMarket(live, leg.market),
      clearLine,
      BEST_FORM_GAMES,
    ).ok;
  });
  if (clean.length < 2) return null;

  const multi = composeSgmMulti(
    {
      gameId: opts.game.id,
      matchup: `${opts.game.homeTeam} vs ${opts.game.awayTeam}`,
      venue: opts.game.venue,
      round: opts.game.round,
      sportsbetLink: opts.sportsbetLink,
      bookmakerLabel: opts.bookmakerLabel,
    },
    clean,
  );

  multi.id = `best:${multi.id}`;
  multi.rationale = [
    `BEST · ${clean.length} legs · each hit in all last ${BEST_FORM_GAMES} ESPN games`,
    `Each leg ≤ $${maxPrice.toFixed(2)} (your max per-leg)`,
    opts.requireSportsbet !== false
      ? `Live ${opts.bookmakerLabel ?? "book"} player props only`
      : "Player props (book prices when matched)",
    ...multi.rationale.filter(
      (r) => !r.startsWith("BEST ·") && !r.startsWith("Each leg ≤"),
    ),
  ];
  multi.edgeScore += 0.15;
  return multi;
}

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

/** Explicit nicknames only — never prefix-match (Jack≠Jackson). */
const FIRST_NAME_ALIASES: Record<string, readonly string[]> = {
  tom: ["thomas", "tommy"],
  thomas: ["tom", "tommy"],
  tommy: ["tom", "thomas"],
  will: ["william", "bill", "billy"],
  william: ["will", "bill", "billy"],
  bill: ["william", "will", "billy"],
  billy: ["william", "will", "bill"],
  josh: ["joshua"],
  joshua: ["josh"],
  matt: ["matthew"],
  matthew: ["matt"],
  mike: ["michael"],
  michael: ["mike"],
  chris: ["christopher"],
  christopher: ["chris"],
  nick: ["nicholas"],
  nicholas: ["nick"],
  alex: ["alexander", "alexandra"],
  alexander: ["alex"],
  sam: ["samuel"],
  samuel: ["sam"],
  ben: ["benjamin"],
  benjamin: ["ben"],
  dan: ["daniel"],
  daniel: ["dan"],
  jim: ["james", "jimmy"],
  james: ["jim", "jimmy"],
  jimmy: ["james", "jim"],
};

function firstNamesCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  // Single initial only (D Parish ↔ Darcy Parish)
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  const aAliases = new Set([a, ...(FIRST_NAME_ALIASES[a] ?? [])]);
  const bAliases = new Set([b, ...(FIRST_NAME_ALIASES[b] ?? [])]);
  for (const x of aAliases) {
    if (bAliases.has(x)) return true;
  }
  return false;
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
  if (aLast !== bLast) return false;
  return firstNamesCompatible(ap[0], bp[0]);
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

/** Count how many of the last N games cleared the threshold (for UI / soft signals). */
export function countRecentFormHits(
  values: number[],
  threshold: number,
  n: number = BEST_FORM_GAMES,
): { games: number; hits: number; values: number[]; rate: number } {
  const window = values.slice(-n).filter((v) => Number.isFinite(Number(v)));
  const hits = window.filter((v) => Number(v) >= threshold).length;
  return {
    games: window.length,
    hits,
    values: window,
    rate: window.length ? hits / window.length : 0,
  };
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

/**
 * Attach L5 hit counts to every player-prop leg.
 * ESPN only, full last-5 played window required — never seed / partial fakes.
 */
export function annotateLegsWithRecentForm(
  legs: CandidateLeg[],
  game: EnrichedGame,
  liveByName?: Map<string, LiveFormLine>,
): CandidateLeg[] {
  return legs.map((leg) => {
    if (!isPlayerPropMarket(leg.market)) return leg;

    const clearLine = resolveClearLine(leg);
    if (clearLine == null) return leg;

    const verified = verifyEspnForm(leg, liveByName);
    if (!verified || verified.games < BEST_FORM_MIN_GAMES) return leg;

    const impact =
      verified.hits === verified.games
        ? ("positive" as const)
        : verified.rate >= 0.6
          ? ("neutral" as const)
          : ("negative" as const);

    const player = findPlayer(leg, game);

    return {
      ...leg,
      playerId: leg.playerId ?? player?.id,
      playerName: leg.playerName ?? player?.name ?? verified.name,
      recentFormHits: verified.hits,
      recentFormGames: verified.games,
      recentFormValues: verified.values,
      factors: [
        ...leg.factors.filter((f) => f.key !== "recent-form"),
        {
          key: "recent-form",
          label: "Recent form",
          impact,
          detail: `L${verified.games} ${verified.hits}/${verified.games} · ${clearLine}+ [${verified.values.join(", ")}] · ESPN`,
          weight:
            verified.hits === verified.games
              ? 0.02
              : verified.rate < 0.4
                ? -0.02
                : 0,
        },
      ],
    };
  });
}

export function isPlayerPropMarket(market: MarketType): boolean {
  return (
    market === "player_goal" ||
    market === "player_disposal" ||
    market === "player_mark" ||
    market === "player_tackle"
  );
}

/** Real book board line (not a Bounce model leg that merely copied a price). */
export function isVerifiedSportsbetLeg(leg: CandidateLeg): boolean {
  if (leg.sportsbetOdds == null || !Number.isFinite(leg.sportsbetOdds)) {
    return false;
  }
  if (leg.sportsbetBoardLeg === true) return true;
  // Matched model→board overlay must carry market + selection from the line
  return Boolean(leg.sportsbetMarket && leg.sportsbetSelection);
}

/**
 * Re-check ESPN at publish time — never trust a stale recentFormHits field alone.
 */
export function verifyEspnForm(
  leg: CandidateLeg,
  liveByName?: Map<string, LiveFormLine>,
): {
  name: string;
  games: number;
  hits: number;
  values: number[];
  rate: number;
  clearLine: number;
} | null {
  if (!isPlayerPropMarket(leg.market)) return null;
  const clearLine = resolveClearLine(leg);
  if (clearLine == null) return null;
  const live = lookupLiveFormForAnnotation(liveByName, undefined, leg, BEST_FORM_MIN_GAMES);
  if (!live || live.games < BEST_FORM_MIN_GAMES) return null;
  const recent = recentValuesForMarket(live, leg.market);
  const hit = countRecentFormHits(recent, clearLine, BEST_FORM_GAMES);
  if (hit.games < BEST_FORM_MIN_GAMES) return null;
  return {
    name: live.name,
    games: hit.games,
    hits: hit.hits,
    values: hit.values,
    rate: hit.rate,
    clearLine,
  };
}

/** Live board price + ESPN-verified full last-5 clears (re-checked). */
export function isPerfectFormSbLeg(
  leg: CandidateLeg,
  liveByName?: Map<string, LiveFormLine>,
): boolean {
  if (!isVerifiedSportsbetLeg(leg)) return false;
  if (!isPlayerPropMarket(leg.market)) return false;
  if (liveByName) {
    const verified = verifyEspnForm(leg, liveByName);
    return (
      verified != null &&
      verified.games >= BEST_FORM_MIN_GAMES &&
      verified.hits === verified.games
    );
  }
  // Fallback when map unavailable — still require stored fields to be a clean 5/5
  const games = leg.recentFormGames;
  const hits = leg.recentFormHits;
  if (games == null || hits == null) return false;
  if (games < BEST_FORM_MIN_GAMES || hits !== games) return false;
  if (!leg.recentFormValues || leg.recentFormValues.length < BEST_FORM_MIN_GAMES) {
    return false;
  }
  return true;
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

function lookupLiveFormForAnnotation(
  liveByName: Map<string, LiveFormLine> | undefined,
  player: PlayerProfile | undefined,
  leg: CandidateLeg,
  minGames: number = 1,
): LiveFormLine | undefined {
  if (!liveByName?.size) return undefined;

  const nameKeys = [
    player?.name,
    leg.playerName,
    // "Callum Wilkie 2+ Tackles" → try leading name tokens when playerName missing
    leg.label?.replace(/\s+\d+\+.*$/, "").trim(),
  ].filter(Boolean) as string[];

  for (const key of nameKeys) {
    const direct = liveByName.get(normalizePersonName(key));
    if (direct && direct.games >= minGames) return direct;
  }
  for (const key of nameKeys) {
    const found = [...liveByName.values()].find((l) => namesMatch(l.name, key));
    if (found && found.games >= minGames) return found;
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
    if (requireSb && !isVerifiedSportsbetLeg(leg)) continue;

    const price = legPrice(leg);
    if (!(price <= maxPrice + 1e-9)) continue;

    // Re-verify ESPN at lock time — never trust a precomputed badge alone
    const verified = verifyEspnForm(leg, opts?.liveByName);
    if (!verified || verified.hits !== verified.games) continue;

    const player = findPlayer(leg, game);
    if (
      player &&
      leg.market === "player_mark" &&
      !player.marksExplicit &&
      player.formSource !== "espn"
    ) {
      continue;
    }
    if (
      player &&
      leg.market === "player_tackle" &&
      !player.tacklesExplicit &&
      player.formSource !== "espn"
    ) {
      continue;
    }

    const annotated: CandidateLeg = {
      ...leg,
      playerId: leg.playerId ?? player?.id,
      playerName: leg.playerName ?? player?.name ?? verified.name,
      threshold: verified.clearLine,
      recentFormHits: verified.hits,
      recentFormGames: verified.games,
      recentFormValues: verified.values,
      factors: [
        ...leg.factors.filter(
          (f) => f.key !== "best-form" && f.key !== "recent-form",
        ),
        {
          key: "best-form",
          label: "Recent form",
          impact: "positive",
          detail: `L${verified.games} ${verified.hits}/${verified.games} · ${verified.clearLine}+ every game [${verified.values.join(", ")}] · ESPN · ≤$${maxPrice.toFixed(2)}`,
          weight: 0.05,
        },
      ],
    };
    locks.push(annotated);
  }

  // One leg per player+market — keep the toughest threshold still at 100%
  const byKey = new Map<string, CandidateLeg>();
  for (const leg of locks) {
    const key = `${leg.playerId ?? leg.playerName}:${leg.market}`;
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

  // Final hard filter — never ship a leg over the user's max or under ESPN 5/5
  const clean = picked.filter((leg) => {
    if (legPrice(leg) > maxPrice + 1e-9) return false;
    return isPerfectFormSbLeg(leg, opts.liveByName);
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
    `Live ${opts.bookmakerLabel ?? "book"} prices only — no Bounce model fill-ins`,
    ...multi.rationale.filter(
      (r) =>
        !r.startsWith("BEST ·") &&
        !r.startsWith("Each leg ≤") &&
        !r.startsWith("Live "),
    ),
  ];
  multi.edgeScore += 0.15;
  return multi;
}

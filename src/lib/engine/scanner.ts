import type { CandidateLeg, ScanMode, SgmMulti } from "../types";
import { clamp, combineIndependentProb, combineOdds, legEdge } from "./odds";

export const MIN_LEGS = 2;
export const MAX_LEGS = 25;
/** In target-price mode, every leg must be at or under this decimal price. */
export const MAX_SINGLE_LEG_PRICE = 1.35;

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const n = arr.length;
  if (k <= 0 || k > n) return out;

  const idx = Array.from({ length: k }, (_, i) => i);
  const push = () => out.push(idx.map((i) => arr[i]));

  push();
  while (true) {
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    push();
    if (out.length >= 8000) break; // hard safety
  }
  return out;
}

function hasConflicts(combo: CandidateLeg[]): boolean {
  const wins = combo.filter((l) => l.market === "match_result");
  if (wins.length > 1) return true;

  const playerMarkets = new Set<string>();
  for (const leg of combo) {
    if (!leg.playerId || leg.threshold == null) continue;
    const key = `${leg.playerId}:${leg.market}`;
    if (playerMarkets.has(key)) return true;
    playerMarkets.add(key);
  }
  return false;
}

function correlationPenalty(legs: CandidateLeg[]): number {
  let penalty = 0;
  const groups = new Map<string, number>();
  const players = new Set<string>();

  for (const leg of legs) {
    groups.set(leg.correlationGroup, (groups.get(leg.correlationGroup) ?? 0) + 1);
    if (leg.playerId) {
      if (players.has(leg.playerId)) penalty += 0.12;
      players.add(leg.playerId);
    }
  }

  for (const [group, count] of groups) {
    if (count > 1 && group.startsWith("goals:")) {
      penalty += 0.06 * (count - 1);
    }
    if (count > 1 && group === "match-result") penalty += 0.2;
    if (count > 1 && group === "totals") penalty += 0.15;
  }

  const hasWin = legs.some((l) => l.market === "match_result");
  const favGoals = legs.filter((l) => l.market === "player_goal").length;
  if (hasWin && favGoals >= 2) penalty += 0.05;

  // Large stacks get a soft diversity penalty so mega-SGMs aren't pure goal spam
  if (legs.length >= 10) {
    const goalShare =
      legs.filter((l) => l.market === "player_goal").length / legs.length;
    if (goalShare > 0.55) penalty += (goalShare - 0.55) * 0.25;
  }

  return penalty;
}

function buildMulti(
  gameMeta: {
    gameId: number;
    matchup: string;
    venue: string;
    round: number;
    sportsbetLink?: string;
    bookmakerLabel?: string;
  },
  legs: CandidateLeg[],
): SgmMulti {
  const penalty = correlationPenalty(legs);
  const rawProb = combineIndependentProb(legs.map((l) => l.probability));
  const adjustedProb = Math.max(0.001, rawProb * (1 - penalty));
  const combinedOdds = combineOdds(legs.map((l) => l.odds));
  const sbPrices = legs.map((l) => l.sportsbetOdds).filter((x): x is number => x != null);
  const sportsbetCoverage = sbPrices.length / Math.max(legs.length, 1);
  const sportsbetCombinedOdds =
    sbPrices.length === legs.length ? combineOdds(sbPrices) : null;
  // Multi confidence = average leg hit-confidence, minus correlation haircut
  const avgLegConfidence =
    legs.reduce((a, l) => a + l.confidence, 0) / Math.max(legs.length, 1);
  const confidence = clamp(
    avgLegConfidence - penalty * 0.35,
    0.05,
    0.97,
  );

  const rationale = [
    ...legs.slice(0, 3).flatMap((l) =>
      l.factors
        .filter((f) => f.impact === "positive")
        .slice(0, 1)
        .map((f) => `${l.shortLabel}: ${f.detail}`),
    ),
  ].slice(0, 5);

  if (penalty > 0.08) {
    rationale.push("Correlation haircut applied for stacked same-team markets");
  }
  if (legs.length >= 8) {
    rationale.push(
      `${legs.length}-leg build used beam search (full enumeration is too large)`,
    );
  }
  const bookLabel = gameMeta.bookmakerLabel ?? "Book";
  if (sportsbetCombinedOdds != null) {
    rationale.push(
      `${bookLabel} leg product ${sportsbetCombinedOdds.toFixed(2)} (actual SGM price may differ with correlation)`,
    );
  } else if (sbPrices.length > 0) {
    rationale.push(
      `${bookLabel} matched ${sbPrices.length}/${legs.length} legs — incomplete book price`,
    );
  }

  const edgeScore =
    confidence * 0.55 +
    (1 - Math.min(combinedOdds / 100, 1)) * 0.1 +
    legs.reduce((a, l) => a + Math.max(0, l.valueScore), 0) * 0.2 -
    penalty +
    sportsbetCoverage * 0.05;

  return {
    id: `${gameMeta.gameId}:${legs.map((l) => l.id).join("|")}`,
    gameId: gameMeta.gameId,
    matchup: gameMeta.matchup,
    venue: gameMeta.venue,
    round: gameMeta.round,
    legs,
    combinedOdds: sportsbetCombinedOdds ?? combinedOdds,
    sportsbetCombinedOdds,
    sportsbetCoverage,
    sportsbetLink: gameMeta.sportsbetLink,
    combinedProbability: adjustedProb,
    confidence: Math.max(0.05, Math.min(0.95, confidence)),
    edgeScore,
    rationale,
  };
}

export interface ScanEngineResult {
  multis: SgmMulti[];
  candidatesEvaluated: number;
  combinationsChecked: number;
}

function priceAttractiveness(odds: number): number {
  if (odds < 2) return -0.35;
  if (odds < 3) return -0.1;
  if (odds <= 30) return 0.15;
  if (odds <= 60) return 0.05;
  if (odds <= 500) return 0.02;
  return -0.02;
}

function scorePartial(legs: CandidateLeg[]): number {
  if (!legs.length) return -Infinity;
  const conf = legs.reduce((a, l) => a + legEdge(l), 0) / legs.length;
  return conf - correlationPenalty(legs) * 0.8;
}

function canAdd(current: CandidateLeg[], next: CandidateLeg): boolean {
  return !hasConflicts([...current, next]);
}

/**
 * Beam + greedy builders for large leg counts.
 * Guarantees completion when enough non-conflicting legs exist.
 */
function beamBuildCombos(
  pool: CandidateLeg[],
  k: number,
  maxResults: number,
): { combos: CandidateLeg[][]; checked: number } {
  let checked = 0;
  const combos: CandidateLeg[][] = [];

  function greedyFrom(
    ordered: CandidateLeg[],
    startIndex = 0,
  ): CandidateLeg[] | null {
    const picked: CandidateLeg[] = [];
    const used = new Set<string>();
    // Optional forced start
    if (startIndex >= 0 && startIndex < ordered.length) {
      picked.push(ordered[startIndex]);
      used.add(ordered[startIndex].id);
    }
    for (const cand of ordered) {
      if (picked.length >= k) break;
      if (used.has(cand.id)) continue;
      if (!canAdd(picked, cand)) continue;
      picked.push(cand);
      used.add(cand.id);
      checked++;
    }
    // Second pass with remaining pool if still short (rarer conflict orderings)
    if (picked.length < k) {
      for (const cand of pool) {
        if (picked.length >= k) break;
        if (used.has(cand.id)) continue;
        if (!canAdd(picked, cand)) continue;
        picked.push(cand);
        used.add(cand.id);
        checked++;
      }
    }
    return picked.length === k ? picked : null;
  }

  // Primary: best-first greedy
  const primary = greedyFrom(pool, -1);
  // Fix: startIndex -1 means no forced start - need to handle
  const bestFirst = (() => {
    const picked: CandidateLeg[] = [];
    const used = new Set<string>();
    for (const cand of pool) {
      if (picked.length >= k) break;
      if (used.has(cand.id)) continue;
      if (!canAdd(picked, cand)) continue;
      picked.push(cand);
      used.add(cand.id);
      checked++;
    }
    if (picked.length < k) {
      for (const cand of [...pool].sort((a, b) => a.odds - b.odds)) {
        if (picked.length >= k) break;
        if (used.has(cand.id)) continue;
        if (!canAdd(picked, cand)) continue;
        picked.push(cand);
        used.add(cand.id);
        checked++;
      }
    }
    return picked.length === k ? picked : null;
  })();
  if (bestFirst) combos.push(bestFirst);

  // Starts from top N candidates
  for (let i = 0; i < Math.min(16, pool.length); i++) {
    const g = greedyFrom(pool, i);
    if (g) combos.push(g);
  }

  // Sort variants for diversity
  const byOddsAsc = [...pool].sort((a, b) => a.odds - b.odds);
  const byOddsDesc = [...pool].sort((a, b) => b.odds - a.odds);
  const byConf = [...pool].sort((a, b) => b.confidence - a.confidence);
  const bySb = [...pool].sort((a, b) => {
    const as = a.sportsbetOdds != null ? 1 : 0;
    const bs = b.sportsbetOdds != null ? 1 : 0;
    return bs - as || legEdge(b) - legEdge(a);
  });
  for (const ordered of [byOddsAsc, byOddsDesc, byConf, bySb]) {
    const g = (() => {
      const picked: CandidateLeg[] = [];
      const used = new Set<string>();
      for (const cand of ordered) {
        if (picked.length >= k) break;
        if (used.has(cand.id)) continue;
        if (!canAdd(picked, cand)) continue;
        picked.push(cand);
        used.add(cand.id);
        checked++;
      }
      return picked.length === k ? picked : null;
    })();
    if (g) combos.push(g);
  }

  // Light shuffle variants
  for (let r = 0; r < Math.min(10, maxResults * 3); r++) {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const picked: CandidateLeg[] = [];
    const used = new Set<string>();
    for (const cand of shuffled) {
      if (picked.length >= k) break;
      if (used.has(cand.id)) continue;
      if (!canAdd(picked, cand)) continue;
      picked.push(cand);
      used.add(cand.id);
      checked++;
    }
    if (picked.length === k) combos.push(picked);
  }

  // Beam expansion for polish when k is moderate
  if (k <= 15 && pool.length >= k) {
    const beamWidth = 24;
    let beam: CandidateLeg[][] = [[]];
    for (let depth = 0; depth < k; depth++) {
      const next: { legs: CandidateLeg[]; score: number }[] = [];
      for (const partial of beam) {
        const used = new Set(partial.map((l) => l.id));
        for (const cand of pool) {
          if (used.has(cand.id)) continue;
          if (!canAdd(partial, cand)) continue;
          const legs = [...partial, cand];
          checked++;
          next.push({ legs, score: scorePartial(legs) });
        }
      }
      next.sort((a, b) => b.score - a.score);
      const kept: CandidateLeg[][] = [];
      const seen = new Set<string>();
      for (const row of next) {
        const sig = row.legs
          .map((l) => l.id)
          .sort()
          .join("|");
        if (seen.has(sig)) continue;
        seen.add(sig);
        kept.push(row.legs);
        if (kept.length >= beamWidth) break;
      }
      beam = kept;
      if (!beam.length) break;
    }
    for (const b of beam) {
      if (b.length === k) combos.push(b);
    }
  }

  void primary;
  return { combos, checked };
}

function enumerateCombos(
  pool: CandidateLeg[],
  k: number,
  maxResults: number,
): { combos: CandidateLeg[][]; checked: number } {
  // Full enumeration only for small k
  if (k <= 6 && pool.length <= 16) {
    const limited =
      k <= 3 ? pool.slice(0, 14) : k <= 4 ? pool.slice(0, 12) : pool.slice(0, 10);
    const combos = combinations(limited, k).filter((c) => !hasConflicts(c));
    return { combos, checked: combos.length };
  }
  return beamBuildCombos(pool, k, maxResults);
}

/**
 * Build SGMs toward a target price.
 * - Every leg ≤ maxSinglePrice (hard ceiling)
 * - Prefer legs nearer the ceiling so we don't only stack $1.05 favs
 * - Keep adding until near the target (within maxLegs)
 */
function buildTowardTargetPrice(
  pool: CandidateLeg[],
  target: number,
  maxSinglePrice: number,
  maxResults: number,
  maxLegs: number = MAX_LEGS,
): { combos: CandidateLeg[][]; checked: number } {
  const legCap = Math.min(MAX_LEGS, Math.max(MIN_LEGS, maxLegs));
  // Soft floor: avoid ultra-short fillers far below the user's selected max
  const minPreferred = Math.min(
    maxSinglePrice * 0.92,
    Math.max(1.12, maxSinglePrice * 0.72),
  );

  const shortPool = pool
    .filter((l) => l.odds <= maxSinglePrice + 1e-9)
    .sort(
      (a, b) =>
        // Prefer higher prices (closer to max) then edge
        b.odds - a.odds || legEdge(b) - legEdge(a),
    );

  let checked = 0;
  const combos: CandidateLeg[][] = [];

  function priceFit(odds: number): number {
    // 1.0 at the ceiling, lower as we drift toward short favs
    const span = Math.max(0.05, maxSinglePrice - minPreferred);
    return clamp((odds - minPreferred) / span, 0, 1.15);
  }

  function chase(
    ordered: CandidateLeg[],
    start?: CandidateLeg,
    preferNearMax = true,
  ): CandidateLeg[] | null {
    const picked: CandidateLeg[] = [];
    const used = new Set<string>();
    let product = 1;

    if (start) {
      if (start.odds > maxSinglePrice + 1e-9) return null;
      picked.push(start);
      used.add(start.id);
      product *= start.odds;
      checked++;
    }

    while (picked.length < legCap && product < target * 0.97) {
      let best: CandidateLeg | null = null;
      let bestScore = -Infinity;

      for (const cand of ordered) {
        if (used.has(cand.id)) continue;
        if (cand.odds > maxSinglePrice + 1e-9) continue;
        if (!canAdd(picked, cand)) continue;

        const nextProduct = product * cand.odds;
        // Don't take a leg that blows past target by a lot when we're already close
        if (product >= target * 0.8 && nextProduct > target * 1.45) continue;

        const distanceBefore = Math.abs(
          Math.log(Math.max(product, 1.0001)) - Math.log(target),
        );
        const distanceAfter = Math.abs(Math.log(nextProduct) - Math.log(target));
        const progress = distanceBefore - distanceAfter;
        const overshoot =
          nextProduct > target ? (nextProduct / target - 1) * 2.5 : 0;
        const nearMaxBonus = preferNearMax ? priceFit(cand.odds) * 1.1 : 0;
        // When still well under target, strongly prefer longer legs
        const underTargetBoost =
          product < target * 0.75 ? Math.log(cand.odds) * 1.4 : 0;

        const score =
          progress * 4 +
          nearMaxBonus +
          underTargetBoost +
          legEdge(cand) * 0.35 -
          overshoot -
          correlationPenalty([...picked, cand]) * 0.35;

        checked++;
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }

      if (!best) break;
      picked.push(best);
      used.add(best.id);
      product *= best.odds;
    }

    // Must land reasonably near the target — reject tiny products
    if (picked.length < MIN_LEGS) return null;
    if (product < target * 0.7) return null;
    if (product > target * 1.55) return null;
    return picked;
  }

  // Prefer pool near the user's max price
  const nearMaxPool = shortPool.filter((l) => l.odds >= minPreferred - 1e-9);
  const workPool = nearMaxPool.length >= Math.min(8, legCap + 2) ? nearMaxPool : shortPool;

  const primary = chase(workPool, undefined, true);
  if (primary) combos.push(primary);

  for (const start of workPool.slice(0, Math.min(16, workPool.length))) {
    const variant = chase(workPool, start, true);
    if (variant) combos.push(variant);
  }

  // Confidence-biased variants still respecting near-max preference
  const byConf = [...workPool].sort(
    (a, b) => b.confidence - a.confidence || b.odds - a.odds,
  );
  const confStack = chase(byConf, undefined, true);
  if (confStack) combos.push(confStack);

  // A few shuffles for diversity
  for (let i = 0; i < Math.min(6, maxResults * 2); i++) {
    const shuffled = [...workPool].sort(() => Math.random() - 0.5);
    const v = chase(shuffled, undefined, true);
    if (v) combos.push(v);
  }

  // If near-max pool couldn't hit target, allow full short pool as last resort
  if (!combos.length && workPool !== shortPool) {
    const fallback = chase(shortPool, undefined, false);
    if (fallback) combos.push(fallback);
    for (const start of shortPool.slice(0, 10)) {
      const v = chase(shortPool, start, false);
      if (v) combos.push(v);
    }
  }

  return { combos, checked };
}

export function deepScanGame(opts: {
  gameId: number;
  matchup: string;
  venue: string;
  round: number;
  legs: CandidateLeg[];
  mode: ScanMode;
  /**
   * Legs mode: exact leg count.
   * Target-odds mode: maximum legs allowed (default 6).
   */
  legCount?: number;
  targetOdds?: number;
  maxResults?: number;
  sportsbetLink?: string;
  bookmakerLabel?: string;
  /** Max decimal price per leg when mode is odds (default 1.35) */
  maxSingleLegPrice?: number;
  requireSportsbet?: boolean;
}): ScanEngineResult {
  const { mode, maxResults = 8 } = opts;
  const maxSingle =
    opts.maxSingleLegPrice != null ? opts.maxSingleLegPrice : MAX_SINGLE_LEG_PRICE;
  const requested = Math.min(MAX_LEGS, Math.max(MIN_LEGS, opts.legCount ?? 3));
  /** In target-odds mode, legCount is the max legs allowed */
  const maxLegs = mode === "odds" ? requested : MAX_LEGS;

  // When bookmaker-only, drop model-only candidates up front
  const sourceLegs = opts.requireSportsbet
    ? opts.legs.filter((l) => l.sportsbetOdds != null)
    : opts.legs;

  const gameMeta = {
    gameId: opts.gameId,
    matchup: opts.matchup,
    venue: opts.venue,
    round: opts.round,
    sportsbetLink: opts.sportsbetLink,
    bookmakerLabel: opts.bookmakerLabel,
  };

  // Target-price mode: respect user's max per-leg hard ceiling + max legs
  if (mode === "odds" && opts.targetOdds) {
    const target = opts.targetOdds;
    // Hard ceiling — never silently raise past what the user selected
    const effectiveMax = maxSingle;
    const minPreferred = Math.min(
      effectiveMax * 0.92,
      Math.max(1.12, effectiveMax * 0.72),
    );

    let shortLegs = sourceLegs.filter((l) => l.odds <= effectiveMax + 1e-9);
    // Prefer legs near the selected max price
    const nearMax = shortLegs.filter((l) => l.odds >= minPreferred - 1e-9);
    if (nearMax.length >= Math.min(8, maxLegs + 2)) {
      shortLegs = nearMax;
    }

    const rankedShort = [...shortLegs].sort(
      (a, b) => b.odds - a.odds || legEdge(b) - legEdge(a),
    );
    const pool = rankedShort.slice(0, Math.min(rankedShort.length, 80));
    const candidatesEvaluated = opts.legs.length;

    const { combos, checked } = buildTowardTargetPrice(
      pool,
      target,
      effectiveMax,
      maxResults,
      maxLegs,
    );

    let combinationsChecked = checked;
    const multis: SgmMulti[] = [];

    for (const combo of combos) {
      if (combo.some((l) => l.odds > effectiveMax + 1e-9)) continue;
      if (combo.length > maxLegs) continue;
      if (hasConflicts(combo)) continue;
      multis.push(buildMulti(gameMeta, combo));
    }

    // Only enumerate fixed sizes that can mathematically reach ~75% of target
    const minLegsForTarget = Math.max(
      MIN_LEGS,
      Math.ceil(Math.log(target * 0.75) / Math.log(Math.max(effectiveMax, 1.01))),
    );
    const fixedSizes = [2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20, 22, 25].filter(
      (k) => k <= maxLegs && k >= minLegsForTarget,
    );
    for (const k of fixedSizes) {
      if (k > pool.length) continue;
      const { combos: fixed, checked: c } = enumerateCombos(pool, k, maxResults);
      combinationsChecked += c;
      for (const combo of fixed) {
        if (combo.some((l) => l.odds > effectiveMax + 1e-9)) continue;
        if (hasConflicts(combo)) continue;
        const product = combo.reduce((acc, l) => acc * l.odds, 1);
        if (product < target * 0.75 || product > target * 1.5) continue;
        multis.push(buildMulti(gameMeta, combo));
      }
    }

    const filtered = multis
      .filter((m) => m.legs.every((l) => l.odds <= effectiveMax + 1e-9))
      .filter((m) => m.legs.length <= maxLegs)
      .filter(
        (m) =>
          m.combinedOdds >= target * 0.75 && m.combinedOdds <= target * 1.45,
      )
      .map((m) => ({
        multi: m,
        dist:
          Math.abs(Math.log(m.combinedOdds) - Math.log(target)) /
          Math.log(Math.max(target, 2)),
        avgLeg:
          m.legs.reduce((a, l) => a + l.odds, 0) / Math.max(m.legs.length, 1),
      }))
      .sort((a, b) => {
        // Closest to target first, then higher average leg price, then edge
        const scoreA =
          -a.dist * 2.2 +
          a.avgLeg * 0.35 +
          a.multi.edgeScore * 0.4 +
          a.multi.sportsbetCoverage * 0.08;
        const scoreB =
          -b.dist * 2.2 +
          b.avgLeg * 0.35 +
          b.multi.edgeScore * 0.4 +
          b.multi.sportsbetCoverage * 0.08;
        return scoreB - scoreA;
      })
      .map((x) => x.multi);

    const selected: SgmMulti[] = [];
    for (const m of filtered) {
      const sig = m.legs
        .map((l) => l.id)
        .sort()
        .join();
      const overlapNeeded = Math.max(2, Math.floor(m.legs.length * 0.75));
      const tooClose = selected.some((s) => {
        const shared = s.legs.filter((l) => m.legs.some((x) => x.id === l.id)).length;
        return shared >= overlapNeeded;
      });
      if (tooClose) continue;
      if (selected.some((s) => s.legs.map((l) => l.id).sort().join() === sig)) continue;
      if (!m.rationale.some((r) => r.includes("Target-price"))) {
        m.rationale.push(
          `Target ~$${target} · ≤${maxLegs} legs · each ≤ $${effectiveMax.toFixed(2)} (prefer near max)`,
        );
      }
      selected.push(m);
      if (selected.length >= maxResults) break;
    }

    return { multis: selected, candidatesEvaluated, combinationsChecked };
  }

  // Fixed leg-count mode
  // Live book shorts often sit at $1.15–$1.25; don't wipe the pool at $1.28.
  const minOdds = requested >= 12 ? 1.08 : requested >= 8 ? 1.12 : 1.15;
  const maxProb = requested >= 12 ? 0.96 : 0.9;

  const usable = sourceLegs.filter((l) => {
    const gateOdds = l.modelOdds ?? l.odds;
    // Accept if either model or live price clears the floor (keeps short SB favs + model legs)
    return (
      (l.odds >= minOdds || gateOdds >= minOdds) &&
      l.probability <= maxProb
    );
  });
  const ranked = [...usable].sort((a, b) => {
    const spiceA = Math.min(Math.log(a.odds), 2.2) * 0.15;
    const spiceB = Math.min(Math.log(b.odds), 2.2) * 0.15;
    const sbBoostA = a.sportsbetOdds != null ? 0.08 : 0;
    const sbBoostB = b.sportsbetOdds != null ? 0.08 : 0;
    return legEdge(b) + spiceB + sbBoostB - (legEdge(a) + spiceA + sbBoostA);
  });

  const poolSize =
    requested >= 20
      ? Math.min(ranked.length, 80)
      : requested >= 12
        ? Math.min(ranked.length, 55)
        : requested >= 8
          ? Math.min(ranked.length, 36)
          : Math.min(ranked.length, 20);
  let pool = ranked.slice(0, Math.max(poolSize, requested));

  if (pool.length < requested) {
    pool = [...sourceLegs]
      .sort((a, b) => legEdge(b) - legEdge(a))
      .slice(0, Math.min(sourceLegs.length, Math.max(requested + 10, 80)));
  }
  const candidatesEvaluated = opts.legs.length;

  const multis: SgmMulti[] = [];
  let combinationsChecked = 0;

  if (requested <= pool.length) {
    const { combos, checked } = enumerateCombos(pool, requested, maxResults);
    combinationsChecked += checked;
    for (const combo of combos) {
      if (hasConflicts(combo)) continue;
      multis.push(buildMulti(gameMeta, combo));
    }
  }

  const minCombined = requested >= 10 ? 1.5 : 2.2;
  let filtered = multis
    .filter((m) => m.combinedOdds >= minCombined)
    .sort(
      (a, b) =>
        b.edgeScore +
        priceAttractiveness(b.combinedOdds) +
        b.sportsbetCoverage * 0.1 -
        (a.edgeScore + priceAttractiveness(a.combinedOdds) + a.sportsbetCoverage * 0.1),
    );
  if (!filtered.length) {
    filtered = multis.sort((a, b) => b.edgeScore - a.edgeScore);
  }

  const selected: SgmMulti[] = [];
  for (const m of filtered) {
    const sig = m.legs
      .map((l) => l.id)
      .sort()
      .join();
    const overlapNeeded = Math.max(2, Math.floor(m.legs.length * 0.75));
    const tooClose = selected.some((s) => {
      const shared = s.legs.filter((l) => m.legs.some((x) => x.id === l.id)).length;
      return shared >= overlapNeeded;
    });
    if (tooClose) continue;
    if (selected.some((s) => s.legs.map((l) => l.id).sort().join() === sig)) continue;
    selected.push(m);
    if (selected.length >= maxResults) break;
  }

  return { multis: selected, candidatesEvaluated, combinationsChecked };
}

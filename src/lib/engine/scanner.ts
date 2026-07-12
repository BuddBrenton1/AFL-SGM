import type { CandidateLeg, ScanMode, SgmMulti } from "../types";
import { combineIndependentProb, combineOdds, legEdge } from "./odds";

export const MIN_LEGS = 2;
export const MAX_LEGS = 25;

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
  const confidence =
    legs.reduce((a, l) => a + l.confidence, 0) / legs.length - penalty * 0.5;

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
  if (sportsbetCombinedOdds != null) {
    rationale.push(
      `Sportsbet leg product ${sportsbetCombinedOdds.toFixed(2)} (actual SGM price may differ with correlation)`,
    );
  } else if (sbPrices.length > 0) {
    rationale.push(
      `Sportsbet matched ${sbPrices.length}/${legs.length} legs — incomplete book price`,
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

export function deepScanGame(opts: {
  gameId: number;
  matchup: string;
  venue: string;
  round: number;
  legs: CandidateLeg[];
  mode: ScanMode;
  legCount?: number;
  targetOdds?: number;
  maxResults?: number;
  sportsbetLink?: string;
}): ScanEngineResult {
  const { mode, maxResults = 8 } = opts;
  const requested =
    mode === "legs"
      ? Math.min(MAX_LEGS, Math.max(MIN_LEGS, opts.legCount ?? 3))
      : 0;

  // For huge SGMs, keep more short-priced legs so we can actually fill 20–25
  const minOdds = requested >= 12 ? 1.08 : requested >= 8 ? 1.15 : 1.28;
  const maxProb = requested >= 12 ? 0.96 : 0.88;

  const usable = opts.legs.filter((l) => l.odds >= minOdds && l.probability <= maxProb);
  const ranked = [...usable].sort((a, b) => {
    const spiceA = Math.min(Math.log(a.odds), 2.2) * 0.15;
    const spiceB = Math.min(Math.log(b.odds), 2.2) * 0.15;
    const sbBoostA = a.sportsbetOdds != null ? 0.08 : 0;
    const sbBoostB = b.sportsbetOdds != null ? 0.08 : 0;
    return legEdge(b) + spiceB + sbBoostB - (legEdge(a) + spiceA + sbBoostA);
  });

  // Prefer enough unique markets to fill large SGMs
  const poolSize =
    requested >= 20
      ? Math.min(ranked.length, 80)
      : requested >= 12
        ? Math.min(ranked.length, 55)
        : requested >= 8
          ? Math.min(ranked.length, 36)
          : Math.min(ranked.length, 20);
  let pool = ranked.slice(0, Math.max(poolSize, requested));

  // If still short of k, widen to almost all candidates
  if (mode === "legs" && pool.length < requested) {
    pool = [...opts.legs]
      .sort((a, b) => legEdge(b) - legEdge(a))
      .slice(0, Math.min(opts.legs.length, Math.max(requested + 10, 80)));
  }
  const candidatesEvaluated = opts.legs.length;

  let legSizes: number[];
  if (mode === "legs") {
    legSizes = [requested];
  } else {
    // Odds mode: try a wider range so big prices can land
    legSizes = [2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 22, 25];
  }

  const multis: SgmMulti[] = [];
  let combinationsChecked = 0;

  for (const k of legSizes) {
    if (k > pool.length) continue;
    const { combos, checked } = enumerateCombos(pool, k, maxResults);
    combinationsChecked += checked;

    for (const combo of combos) {
      if (hasConflicts(combo)) continue;
      multis.push(
        buildMulti(
          {
            gameId: opts.gameId,
            matchup: opts.matchup,
            venue: opts.venue,
            round: opts.round,
            sportsbetLink: opts.sportsbetLink,
          },
          combo,
        ),
      );
    }
  }

  let filtered = multis;
  if (mode === "odds" && opts.targetOdds) {
    const target = opts.targetOdds;
    filtered = multis
      .map((m) => ({
        multi: m,
        dist:
          Math.abs(Math.log(m.combinedOdds) - Math.log(target)) /
          Math.log(Math.max(target, 2)),
      }))
      .filter(
        (x) =>
          x.multi.combinedOdds >= target * 0.45 &&
          x.multi.combinedOdds <= target * 2.2,
      )
      .sort((a, b) => {
        const scoreA = a.multi.edgeScore - a.dist * 1.2 + a.multi.sportsbetCoverage * 0.1;
        const scoreB = b.multi.edgeScore - b.dist * 1.2 + b.multi.sportsbetCoverage * 0.1;
        return scoreB - scoreA;
      })
      .map((x) => x.multi);
  } else {
    // Large SGMs are naturally long-priced — don't force $2.20 floor
    const minCombined = requested >= 10 ? 1.5 : 2.2;
    filtered = multis
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

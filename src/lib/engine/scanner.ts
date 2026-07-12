import type { CandidateLeg, ScanMode, SgmMulti } from "../types";
import { combineIndependentProb, combineOdds, legEdge } from "./odds";

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
  }
  return out;
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
      // Same-team goal stack is positively correlated — not independent
      penalty += 0.06 * (count - 1);
    }
    if (count > 1 && group === "match-result") penalty += 0.2;
    if (count > 1 && group === "totals") penalty += 0.15;
  }

  // Win + favourite forward goals are correlated
  const hasWin = legs.some((l) => l.market === "match_result");
  const favGoals = legs.filter((l) => l.market === "player_goal").length;
  if (hasWin && favGoals >= 2) penalty += 0.05;

  return penalty;
}

function buildMulti(
  gameMeta: { gameId: number; matchup: string; venue: string; round: number },
  legs: CandidateLeg[],
): SgmMulti {
  const penalty = correlationPenalty(legs);
  const rawProb = combineIndependentProb(legs.map((l) => l.probability));
  const adjustedProb = Math.max(0.001, rawProb * (1 - penalty));
  const combinedOdds = combineOdds(legs.map((l) => l.odds));
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

  const edgeScore =
    confidence * 0.55 +
    (1 - Math.min(combinedOdds / 100, 1)) * 0.1 +
    legs.reduce((a, l) => a + Math.max(0, l.valueScore), 0) * 0.2 -
    penalty;

  return {
    id: `${gameMeta.gameId}:${legs.map((l) => l.id).join("|")}`,
    gameId: gameMeta.gameId,
    matchup: gameMeta.matchup,
    venue: gameMeta.venue,
    round: gameMeta.round,
    legs,
    combinedOdds,
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
  // Prefer SGMs that actually pay — soft peak around $6–$25
  if (odds < 2) return -0.35;
  if (odds < 3) return -0.1;
  if (odds <= 30) return 0.15;
  if (odds <= 60) return 0.05;
  return -0.05;
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
}): ScanEngineResult {
  const { mode, maxResults = 8 } = opts;
  // Drop ultra-short favourites that crush multi price without adding insight
  const usable = opts.legs.filter((l) => l.odds >= 1.28 && l.probability <= 0.88);
  const ranked = [...usable].sort((a, b) => {
    const spiceA = Math.min(Math.log(a.odds), 2.2) * 0.15;
    const spiceB = Math.min(Math.log(b.odds), 2.2) * 0.15;
    return legEdge(b) + spiceB - (legEdge(a) + spiceA);
  });
  const pool = ranked.slice(0, 20);
  const candidatesEvaluated = opts.legs.length;

  let legSizes: number[];
  if (mode === "legs") {
    legSizes = [opts.legCount ?? 3];
  } else {
    // Odds mode: try a range of leg counts to hit the price
    legSizes = [2, 3, 4, 5, 6];
  }

  const multis: SgmMulti[] = [];
  let combinationsChecked = 0;

  for (const k of legSizes) {
    if (k > pool.length) continue;
    // Cap enumeration for performance
    const limitedPool = pool.slice(0, k <= 3 ? 14 : k <= 4 ? 12 : 10);
    const combos = combinations(limitedPool, k);
    for (const combo of combos) {
      combinationsChecked++;
      // Avoid two mutually exclusive match results
      const wins = combo.filter((l) => l.market === "match_result");
      if (wins.length > 1) continue;
      // Avoid same player conflicting thresholds (keep higher only — skip duplicates)
      const playerMarkets = new Set<string>();
      let conflict = false;
      for (const leg of combo) {
        if (!leg.playerId || leg.threshold == null) continue;
        const key = `${leg.playerId}:${leg.market}`;
        if (playerMarkets.has(key)) {
          conflict = true;
          break;
        }
        playerMarkets.add(key);
      }
      if (conflict) continue;

      multis.push(
        buildMulti(
          {
            gameId: opts.gameId,
            matchup: opts.matchup,
            venue: opts.venue,
            round: opts.round,
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
      .filter((x) => x.multi.combinedOdds >= target * 0.55 && x.multi.combinedOdds <= target * 1.8)
      .sort((a, b) => {
        const scoreA = a.multi.edgeScore - a.dist * 1.2;
        const scoreB = b.multi.edgeScore - b.dist * 1.2;
        return scoreB - scoreA;
      })
      .map((x) => x.multi);
  } else {
    filtered = multis
      .filter((m) => m.combinedOdds >= 2.2)
      .sort(
        (a, b) =>
          b.edgeScore +
          priceAttractiveness(b.combinedOdds) -
          (a.edgeScore + priceAttractiveness(a.combinedOdds)),
      );
    // Fallback if filters were too strict
    if (!filtered.length) {
      filtered = multis.sort((a, b) => b.edgeScore - a.edgeScore);
    }
  }

  // Diversity: don't return near-identical multis
  const selected: SgmMulti[] = [];
  for (const m of filtered) {
    const sig = m.legs
      .map((l) => l.id)
      .sort()
      .join();
    const tooClose = selected.some((s) => {
      const shared = s.legs.filter((l) => m.legs.some((x) => x.id === l.id)).length;
      return shared >= Math.min(s.legs.length, m.legs.length) - 0.5;
    });
    if (tooClose) continue;
    // also skip exact same signature
    if (selected.some((s) => s.legs.map((l) => l.id).sort().join() === sig)) continue;
    selected.push(m);
    if (selected.length >= maxResults) break;
  }

  return { multis: selected, candidatesEvaluated, combinationsChecked };
}

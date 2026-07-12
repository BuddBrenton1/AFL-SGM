import type { CandidateLeg, FactorSignal } from "../types";

/** Convert true probability to book-style decimal odds with ~10% overround share. */
export function probToOdds(probability: number, juice = 0.1): number {
  const p = clamp(probability, 0.02, 0.95);
  const implied = p * (1 - juice);
  return roundOdds(1 / Math.max(implied, 0.02));
}

export function oddsToProb(odds: number, juice = 0.1): number {
  const raw = 1 / Math.max(odds, 1.01);
  return clamp(raw / (1 - juice), 0.02, 0.98);
}

export function combineOdds(odds: number[]): number {
  return roundOdds(odds.reduce((acc, o) => acc * o, 1));
}

export function combineIndependentProb(probs: number[]): number {
  return probs.reduce((acc, p) => acc * p, 1);
}

export function roundOdds(n: number): number {
  if (n >= 10) return Math.round(n * 10) / 10;
  if (n >= 5) return Math.round(n * 20) / 20;
  return Math.round(n * 100) / 100;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function formatOdds(odds: number): string {
  return `$${odds.toFixed(odds >= 10 ? 1 : 2)}`;
}

export function confidenceFromFactors(
  baseProb: number,
  factors: FactorSignal[],
): number {
  const shift = factors.reduce((acc, f) => acc + f.weight, 0);
  const adjusted = clamp(baseProb + shift, 0.05, 0.96);
  // Confidence rewards stable high-probability legs with supportive factors
  const support = factors.filter((f) => f.impact === "positive").length;
  const drag = factors.filter((f) => f.impact === "negative").length;
  return clamp(adjusted * 0.7 + support * 0.04 - drag * 0.03, 0.05, 0.98);
}

export function valueScore(probability: number, odds: number): number {
  const fair = 1 / Math.max(probability, 0.02);
  return (fair - odds) / fair;
}

export function legEdge(leg: CandidateLeg): number {
  return leg.confidence * 0.65 + Math.max(0, leg.valueScore) * 0.35;
}

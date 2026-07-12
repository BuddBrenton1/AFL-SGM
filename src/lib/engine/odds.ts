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

/**
 * Leg confidence ≈ estimated chance the leg hits, nudged by supporting/drag factors.
 * This is what the UI % badge is based on (averaged across the multi).
 */
export function confidenceFromFactors(
  baseProb: number,
  factors: FactorSignal[],
): number {
  const shift = factors.reduce((acc, f) => acc + f.weight, 0);
  const support = factors.filter((f) => f.impact === "positive").length;
  const drag = factors.filter((f) => f.impact === "negative").length;
  // Stay close to true hit probability so a 70% floor is meaningful
  return clamp(baseProb + shift + support * 0.015 - drag * 0.02, 0.05, 0.97);
}

export function valueScore(probability: number, odds: number): number {
  const fair = 1 / Math.max(probability, 0.02);
  return (fair - odds) / fair;
}

export function legEdge(leg: CandidateLeg): number {
  return leg.confidence * 0.65 + Math.max(0, leg.valueScore) * 0.35;
}

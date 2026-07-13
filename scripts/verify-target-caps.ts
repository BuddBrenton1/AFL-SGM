import { deepScanGame, legPrice } from "../src/lib/engine/scanner";
import type { CandidateLeg } from "../src/lib/types";

function leg(
  id: string,
  odds: number,
  confidence = 0.85,
  sportsbetOdds?: number,
): CandidateLeg {
  return {
    id,
    gameId: 1,
    market: "player_disposal",
    label: id,
    shortLabel: id,
    playerId: id,
    playerName: id,
    probability: Math.min(0.9, 1 / odds),
    odds,
    sportsbetOdds,
    confidence,
    valueScore: 0.1,
    factors: [],
    correlationGroup: `disp:${id}`,
  };
}

const pool: CandidateLeg[] = [];
const legal = [1.35, 1.34, 1.33, 1.32, 1.31, 1.3, 1.29, 1.28, 1.27, 1.26, 1.25, 1.24];
for (let i = 0; i < legal.length; i++) {
  pool.push(leg(`ok-${i}`, legal[i], 0.88 - i * 0.005));
}
pool.push(leg("bad-149", 1.49, 0.74));
pool.push(leg("bad-144", 1.44, 0.77));
pool.push(leg("bad-sb", 1.2, 0.8, 1.55));

const { multis } = deepScanGame({
  gameId: 1,
  matchup: "Richmond vs Hawthorn",
  venue: "M.C.G.",
  round: 19,
  legs: pool,
  mode: "odds",
  legCount: 12,
  targetOdds: 10,
  maxSingleLegPrice: 1.35,
  maxResults: 8,
});

let failed = 0;
if (multis.length === 0) {
  console.error("FAIL: expected at least one multi near $10 with ≤$1.35 legs");
  failed++;
}

for (const m of multis) {
  for (const l of m.legs) {
    const p = legPrice(l);
    if (p > 1.35 + 1e-9) {
      console.error(`FAIL: leg ${l.id} price ${p} exceeds $1.35`);
      failed++;
    }
  }
  if (m.combinedOdds < 10 * 0.88 || m.combinedOdds > 10 * 1.22) {
    console.error(
      `FAIL: combined ${m.combinedOdds.toFixed(2)} outside 88–122% of $10`,
    );
    failed++;
  }
  console.log(
    `OK multi ${m.legs.length} legs · $${m.combinedOdds.toFixed(2)} · conf ${(m.confidence * 100).toFixed(0)}%`,
  );
}

if (failed) {
  console.error(`${failed} assertion(s) failed`);
  process.exit(1);
}
console.log(`PASS: ${multis.length} multi(s) respect caps`);

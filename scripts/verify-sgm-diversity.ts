/**
 * Ensures season/form prune + diversity stop near-duplicate SGM remixes.
 * Run: npx --yes tsx scripts/verify-sgm-diversity.ts
 */
import assert from "node:assert/strict";
import {
  deepScanGame,
  prunePoolBySeasonForm,
  selectDiverseMultis,
  seasonFormQuality,
} from "../src/lib/engine/scanner";
import type { CandidateLeg, SgmMulti } from "../src/lib/types";

function makeLeg(opts: {
  id: string;
  playerId: string;
  market?: CandidateLeg["market"];
  threshold: number;
  odds: number;
  confidence: number;
  recentFormHits?: number;
  recentFormGames?: number;
}): CandidateLeg {
  return {
    id: opts.id,
    gameId: 1,
    market: opts.market ?? "player_disposal",
    label: opts.id,
    shortLabel: opts.id,
    playerId: opts.playerId,
    playerName: opts.playerId,
    threshold: opts.threshold,
    probability: Math.min(0.92, 1 / opts.odds),
    odds: opts.odds,
    sportsbetOdds: opts.odds,
    confidence: opts.confidence,
    valueScore: 0.05,
    recentFormHits: opts.recentFormHits,
    recentFormGames: opts.recentFormGames,
    factors: [],
    correlationGroup: `${opts.market ?? "disp"}:${opts.playerId}`,
  };
}

// Same 4 stars × 3 disposal thresholds — classic redundancy trap
const pool: CandidateLeg[] = [];
const stars = ["gawn", "petridis", "neale", "daicos"];
for (const p of stars) {
  for (const thr of [20, 25, 30]) {
    const hits = thr === 20 ? 5 : thr === 25 ? 4 : 2;
    pool.push(
      makeLeg({
        id: `${p}-${thr}`,
        playerId: p,
        threshold: thr,
        odds: thr === 20 ? 1.55 : thr === 25 ? 1.45 : 1.35,
        confidence: thr === 20 ? 0.9 : thr === 25 ? 0.82 : 0.55,
        recentFormHits: hits,
        recentFormGames: 5,
      }),
    );
  }
}
// Extra cast so diversity can spread
for (let i = 0; i < 12; i++) {
  pool.push(
    makeLeg({
      id: `extra-${i}`,
      playerId: `extra-${i}`,
      threshold: 15,
      odds: 1.4 + (i % 5) * 0.04,
      confidence: 0.7 + (i % 4) * 0.04,
      recentFormHits: 3 + (i % 3),
      recentFormGames: 5,
    }),
  );
}

const pruned = prunePoolBySeasonForm(pool);
assert.equal(
  pruned.filter((l) => stars.includes(l.playerId!)).length,
  4,
  "one disposal line per star after prune",
);
for (const p of stars) {
  const kept = pruned.find((l) => l.playerId === p)!;
  assert.ok(kept.threshold === 20 || kept.threshold === 25, `${p} kept solid form line`);
  assert.ok(seasonFormQuality(kept) >= seasonFormQuality(
    makeLeg({
      id: "weak",
      playerId: p,
      threshold: 30,
      odds: 1.35,
      confidence: 0.55,
      recentFormHits: 2,
      recentFormGames: 5,
    }),
  ));
}

const { multis } = deepScanGame({
  gameId: 1,
  matchup: "Test vs Test",
  venue: "Docklands",
  round: 1,
  legs: pool,
  mode: "odds",
  legCount: 8,
  targetOdds: 12,
  maxSingleLegPrice: 1.65,
  maxResults: 8,
});

assert.ok(multis.length >= 1, "expected at least one multi");
assert.ok(multis.length <= 8, "card capped");

// No two returned multis should share ≥50% of legs
for (let i = 0; i < multis.length; i++) {
  for (let j = i + 1; j < multis.length; j++) {
    const a = multis[i].legs;
    const b = multis[j].legs;
    const ids = new Set(b.map((l) => l.id));
    const shared = a.filter((l) => ids.has(l.id)).length;
    const overlap = shared / Math.min(a.length, b.length);
    assert.ok(
      overlap < 0.5,
      `multis ${i},${j} overlap ${overlap.toFixed(2)} too high`,
    );
  }
}

// selectDiverseMultis unit check
const fake: SgmMulti[] = multis.length
  ? [
      multis[0],
      {
        ...multis[0],
        id: "clone",
        legs: multis[0].legs.slice(),
      },
    ]
  : [];
if (fake.length) {
  const diverse = selectDiverseMultis(fake, 4);
  assert.equal(diverse.length, 1, "exact/near clones collapse to one");
}

console.log(
  `verify-sgm-diversity: OK · pruned ${pool.length}→${pruned.length} · card ${multis.length}`,
);

import assert from "node:assert/strict";
import {
  BEST_MAX_LEG_PRICE,
  collectBestFormLegs,
  hitEveryRecentGame,
} from "../src/lib/engine/best-form";
import type { CandidateLeg, EnrichedGame, PlayerProfile } from "../src/lib/types";

const hit = hitEveryRecentGame([34, 29, 33, 28, 32], 20, 5);
assert.equal(hit.ok, true);
assert.equal(hit.hits, 5);

const miss = hitEveryRecentGame([34, 29, 19, 28, 32], 20, 5);
assert.equal(miss.ok, false);
assert.equal(miss.hits, 4);

const player: PlayerProfile = {
  id: "p1",
  name: "Test Mid",
  team: "richmond",
  role: "midfielder",
  jumper: 1,
  roleStability: 0.9,
  form: {
    games: 16,
    goalsAvg: 0.4,
    disposalsAvg: 28,
    marksAvg: 4,
    tacklesAvg: 5,
    hitoutsAvg: 0,
    homeGoalsAvg: 0.4,
    awayGoalsAvg: 0.4,
    homeDisposalsAvg: 28,
    awayDisposalsAvg: 28,
    last5Goals: [1, 0, 1, 0, 1],
    last5Disposals: [30, 27, 31, 26, 29],
    last5Marks: [4, 5, 4, 3, 5],
    last5Tackles: [5, 6, 4, 5, 7],
    goalHitRates: { "1+": 0.6 },
    disposalHitRates: { "20+": 0.95, "25+": 0.88 },
  },
};

const danger: PlayerProfile = {
  ...player,
  id: "danger",
  name: "Patrick Dangerfield",
  form: {
    ...player.form,
    last5Disposals: [28, 15, 19, 17, 22],
    disposalHitRates: { "15+": 0.72, "20+": 0.3, "25+": 0.12 },
  },
};

const game = {
  id: 1,
  homeTeam: "Geelong",
  awayTeam: "St Kilda",
  homePlayers: [player, danger],
  awayPlayers: [],
} as unknown as EnrichedGame;

function leg(
  id: string,
  playerId: string,
  threshold: number,
  price: number,
  hitRatesOk = true,
): CandidateLeg {
  return {
    id,
    gameId: 1,
    market: "player_disposal",
    label: `${playerId} ${threshold}+`,
    shortLabel: `${threshold}+`,
    playerId,
    threshold,
    probability: 1 / price,
    odds: price,
    sportsbetOdds: price,
    confidence: hitRatesOk ? 0.9 : 0.3,
    valueScore: 0.1,
    factors: [],
    correlationGroup: `disp:${playerId}`,
  };
}

const locks = collectBestFormLegs(
  [
    leg("ok-25", "p1", 25, 1.22),
    leg("ok-20", "p1", 20, 1.1),
    leg("danger-long", "danger", 20, 3.3),
    leg("danger-form", "danger", 15, 1.25), // form not 100% L5 for 15+ either (15,19,17 miss? 15 clears; 15,19,17,22,28 — 15 clears all? 15,19,17,22,28 all >= 15! and season 72% fails)
  ],
  game,
  { requireSportsbet: true },
);

assert.ok(
  locks.every((l) => (l.sportsbetOdds ?? l.odds) <= BEST_MAX_LEG_PRICE),
  "no long-priced legs",
);
assert.ok(!locks.some((l) => l.playerId === "danger"), "Dangerfield excluded");
assert.equal(locks.length, 1);
assert.equal(locks[0].threshold, 25);

console.log("PASS: best-form rejects long/low-rate Dangerfield-style legs");

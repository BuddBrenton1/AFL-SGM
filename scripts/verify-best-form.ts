import assert from "node:assert/strict";
import {
  collectBestFormLegs,
  hitEveryRecentGame,
} from "../src/lib/engine/best-form";
import type { CandidateLeg, EnrichedGame, PlayerProfile } from "../src/lib/types";

const hit = hitEveryRecentGame([34, 29, 33, 28, 32], 20, 5);
assert.equal(hit.ok, true);
assert.equal(hit.games, 5);

const miss = hitEveryRecentGame([34, 29, 19, 28, 32], 20, 5);
assert.equal(miss.ok, false);

const four = hitEveryRecentGame([22, 25, 21, 24], 20, 5);
assert.equal(four.ok, true);
assert.equal(four.games, 4);

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
    disposalHitRates: { "20+": 0.95, "25+": 0.8 },
  },
};

const game = {
  id: 1,
  homeTeam: "Richmond",
  awayTeam: "Hawthorn",
  homePlayers: [player],
  awayPlayers: [],
} as unknown as EnrichedGame;

const legs: CandidateLeg[] = [
  {
    id: "1",
    gameId: 1,
    market: "player_disposal",
    label: "Test Mid 25+ Disposals",
    shortLabel: "Mid 25+",
    playerId: "p1",
    threshold: 25,
    probability: 0.8,
    odds: 1.25,
    sportsbetOdds: 1.22,
    confidence: 0.85,
    valueScore: 0.1,
    factors: [],
    correlationGroup: "disp:p1",
  },
  {
    id: "2",
    gameId: 1,
    market: "player_disposal",
    label: "Test Mid 20+ Disposals",
    shortLabel: "Mid 20+",
    playerId: "p1",
    threshold: 20,
    probability: 0.9,
    odds: 1.12,
    sportsbetOdds: 1.1,
    confidence: 0.9,
    valueScore: 0.1,
    factors: [],
    correlationGroup: "disp:p1",
  },
  {
    id: "3",
    gameId: 1,
    market: "match_result",
    label: "Richmond",
    shortLabel: "Rich",
    probability: 0.6,
    odds: 1.6,
    sportsbetOdds: 1.55,
    confidence: 0.6,
    valueScore: 0,
    factors: [],
    correlationGroup: "match-result",
  },
];

const locks = collectBestFormLegs(legs, game, { requireSportsbet: true });
assert.equal(locks.length, 1, "should keep highest 100% threshold only");
assert.equal(locks[0].threshold, 25);

console.log("PASS: best-form locks");

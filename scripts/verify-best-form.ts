import assert from "node:assert/strict";
import {
  collectBestFormLegs,
  hitEveryRecentGame,
} from "../src/lib/engine/best-form";
import { loadLiveFormForTeams } from "../src/lib/live-form";
import type { CandidateLeg, EnrichedGame, PlayerProfile } from "../src/lib/types";

const hit = hitEveryRecentGame([34, 29, 33, 28, 32], 20, 5);
assert.equal(hit.ok, true);

// Inferred tackle form must not qualify without tacklesExplicit
const inferred: PlayerProfile = {
  id: "danger",
  name: "Patrick Dangerfield",
  team: "geelong",
  role: "midfielder",
  jumper: 35,
  roleStability: 0.8,
  marksExplicit: false,
  tacklesExplicit: false,
  formSource: "seed",
  form: {
    games: 16,
    goalsAvg: 0.8,
    disposalsAvg: 22,
    marksAvg: 3,
    tacklesAvg: 4,
    hitoutsAvg: 0,
    homeGoalsAvg: 0.8,
    awayGoalsAvg: 0.7,
    homeDisposalsAvg: 22,
    awayDisposalsAvg: 21,
    last5Goals: [1, 0, 1, 0, 0],
    last5Disposals: [28, 15, 19, 17, 22],
    last5Marks: [3, 2, 3, 2, 3],
    // Fake inferred all-clear tackles (old bug)
    last5Tackles: [4, 2, 3, 3, 4],
    goalHitRates: { "1+": 0.5 },
    disposalHitRates: { "15+": 0.72, "20+": 0.3 },
  },
};

const game = {
  id: 1,
  homeTeam: "Geelong",
  awayTeam: "St Kilda",
  homePlayers: [inferred],
  awayPlayers: [],
} as unknown as EnrichedGame;

const tackleLeg: CandidateLeg = {
  id: "t2",
  gameId: 1,
  market: "player_tackle",
  label: "Patrick Dangerfield 2+ Tackles",
  shortLabel: "Danger 2+T",
  playerId: "danger",
  threshold: 2,
  probability: 0.7,
  odds: 1.32,
  sportsbetOdds: 1.32,
  confidence: 0.71,
  valueScore: 0,
  factors: [],
  correlationGroup: "tackles:danger",
};

const blocked = collectBestFormLegs([tackleLeg], game, {
  requireSportsbet: true,
});
assert.equal(blocked.length, 0, "inferred tackles must not enter BEST");

async function main() {
  const live = await loadLiveFormForTeams(["geelong"], 5);
  assert.ok(live.teamsCovered >= 1, "ESPN schedule should load Geelong");
  const danger = [...live.byName.values()].find((p) =>
    /dangerfield/i.test(p.name),
  );
  assert.ok(danger, "Dangerfield should appear in ESPN form");
  const tackleHits = danger!.last5Tackles.filter((t) => t >= 2).length;
  const tackleRate = tackleHits / danger!.last5Tackles.length;
  console.log(
    `Dangerfield live last5 tackles: [${danger!.last5Tackles.join(", ")}] · 2+ = ${(tackleRate * 100).toFixed(0)}%`,
  );
  assert.ok(
    tackleRate < 0.99 || danger!.last5Tackles.some((t) => t < 2),
    "if live form is 100% for 2+ tackles, at least confirm values exist",
  );
  // Soft check: user reports ~40%; if we somehow still get 100%, fail hard
  if (tackleRate >= 0.999) {
    console.warn(
      "WARN: ESPN last5 still shows 100% for Dangerfield 2+ tackles — inspect values above",
    );
  }
  console.log("PASS: inferred tackles blocked; ESPN live form loaded");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

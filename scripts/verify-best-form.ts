import assert from "node:assert/strict";
import {
  collectBestFormLegs,
  hitEveryRecentGame,
} from "../src/lib/engine/best-form";
import { applyLiveFormToPlayers, loadLiveFormForTeams } from "../src/lib/live-form";
import { getPlayer } from "../src/lib/players";
import type { CandidateLeg, EnrichedGame } from "../src/lib/types";

assert.equal(hitEveryRecentGame([30, 22, 20, 17, 12], 14, 5).ok, false);
assert.equal(hitEveryRecentGame([30, 22, 20, 17, 12], 14, 5).hits, 4);

async function main() {
  const live = await loadLiveFormForTeams(["geelong"], 5);
  const seed = getPlayer("gee-danger")!;
  const applied = applyLiveFormToPlayers([seed], live.byName);
  assert.equal(applied.matched, 1);
  const player = applied.players[0];
  assert.equal(player.formSource, "espn");
  console.log("Dangerfield ESPN D", player.form.last5Disposals);
  console.log("14+ rate", player.form.disposalHitRates["14+"]);

  const game = {
    id: 1,
    homeTeam: "Geelong",
    awayTeam: "St Kilda",
    homePlayers: applied.players,
    awayPlayers: [],
  } as unknown as EnrichedGame;

  const leg14: CandidateLeg = {
    id: "d14",
    gameId: 1,
    market: "player_disposal",
    label: "Patrick Dangerfield 14+ Disposals",
    shortLabel: "Danger 14+",
    playerId: "gee-danger",
    threshold: 14,
    probability: 0.7,
    odds: 1.3,
    sportsbetOdds: 1.3,
    confidence: 0.72,
    valueScore: 0,
    factors: [],
    correlationGroup: "disp:gee-danger",
  };

  const locks = collectBestFormLegs([leg14], game, { requireSportsbet: true });
  assert.equal(locks.length, 0, "Dangerfield 14+ must not be a BEST lock");
  console.log("PASS: Dangerfield 14+ excluded from BEST with ESPN form");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

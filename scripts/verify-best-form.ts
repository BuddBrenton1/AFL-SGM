import assert from "node:assert/strict";
import {
  annotateLegsWithRecentForm,
  collectBestFormLegs,
  countRecentFormHits,
  hitEveryRecentGame,
} from "../src/lib/engine/best-form";
import {
  applyLiveFormToPlayers,
  loadLiveFormForTeams,
} from "../src/lib/live-form";
import { getPlayer } from "../src/lib/players";
import type { CandidateLeg, EnrichedGame } from "../src/lib/types";

assert.equal(hitEveryRecentGame([30, 22, 20, 17, 12], 14, 5).ok, false);
assert.equal(hitEveryRecentGame([30, 22, 20, 17, 12], 14, 5).hits, 4);
assert.equal(countRecentFormHits([30, 22, 20, 17, 12], 14, 5).hits, 4);
assert.equal(countRecentFormHits([30, 22, 20, 17, 12], 14, 5).games, 5);
assert.equal(countRecentFormHits([10, 8, 9, 7, 6], 14, 5).hits, 0);

async function main() {
  const live = await loadLiveFormForTeams(["geelong"], 5);
  const seed = getPlayer("gee-danger")!;
  const applied = applyLiveFormToPlayers([seed], live.byName);
  assert.equal(applied.matched, 1);
  const player = applied.players[0];
  assert.equal(player.formSource, "espn");

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
    playerName: "Patrick Dangerfield",
    threshold: 14,
    sportsbetPoint: 13.5,
    probability: 0.7,
    odds: 1.3,
    sportsbetOdds: 1.3,
    confidence: 0.72,
    valueScore: 0,
    factors: [],
    correlationGroup: "disp:gee-danger",
  };

  // Over user's $1.20 max — must drop even before form check
  const overMax = collectBestFormLegs([leg14], game, {
    requireSportsbet: true,
    maxLegPrice: 1.2,
    liveByName: live.byName,
  });
  assert.equal(overMax.length, 0, "must respect $1.20 max (leg is $1.30)");

  // Even with a high max, ESPN form must reject 14+ (12 disposal miss)
  const formFail = collectBestFormLegs([leg14], game, {
    requireSportsbet: true,
    maxLegPrice: 1.65,
    liveByName: live.byName,
  });
  assert.equal(formFail.length, 0, "Dangerfield 14+ must fail ESPN last-5");

  // Synthetic perfect form still blocked without liveByName
  const noLive = collectBestFormLegs([leg14], game, {
    requireSportsbet: true,
    maxLegPrice: 1.65,
  });
  assert.equal(noLive.length, 0, "no ESPN map → no BEST lock");

  // Control: 12+ should pass on ESPN [30,22,20,17,12] if price ok
  const leg12 = { ...leg14, id: "d12", threshold: 12, sportsbetPoint: 11.5, sportsbetOdds: 1.15, odds: 1.15 };
  const ok12 = collectBestFormLegs([leg12], game, {
    requireSportsbet: true,
    maxLegPrice: 1.2,
    liveByName: live.byName,
  });
  assert.equal(ok12.length, 1, "12+ clears all last-5 and is ≤$1.20");

  // Target SGMs: annotate even failing lines so UI can show L5 4/5 etc.
  const annotated = annotateLegsWithRecentForm([leg14], game, live.byName);
  assert.equal(annotated[0].recentFormGames, 5);
  assert.equal(annotated[0].recentFormHits, 4);
  assert.ok(
    annotated[0].factors.some((f) => f.key === "recent-form"),
    "recent-form factor attached",
  );

  // Board-only athlete (not in seed roster) still gets L5 via ESPN name lookup
  const boardOnly: CandidateLeg = {
    id: "wilkie-t2",
    gameId: 1,
    market: "player_tackle",
    label: "Callum Wilkie 2+ Tackles",
    shortLabel: "Wilkie 2+T",
    playerName: "Callum Wilkie",
    threshold: 2,
    sportsbetPoint: 1.5,
    sportsbetOdds: 1.25,
    probability: 0.7,
    odds: 1.25,
    confidence: 0.7,
    valueScore: 0,
    factors: [],
    correlationGroup: "player:callum wilkie",
  };
  // Inject a fake ESPN line under Wilkie if live fetch didn't include him
  if (![...live.byName.values()].some((l) => /wilkie/i.test(l.name))) {
    live.byName.set("callum wilkie", {
      name: "Callum Wilkie",
      team: "stkilda",
      games: 5,
      last5Goals: [0, 0, 0, 0, 0],
      last5Disposals: [18, 20, 16, 19, 17],
      last5Marks: [6, 5, 7, 4, 6],
      last5Tackles: [3, 2, 1, 4, 2],
    });
  }
  const boardAnnotated = annotateLegsWithRecentForm(
    [boardOnly],
    { ...game, awayPlayers: [] } as EnrichedGame,
    live.byName,
  );
  assert.ok(
    (boardAnnotated[0].recentFormGames ?? 0) >= 1,
    "board-only player must get L5 from ESPN by name",
  );

  console.log("PASS: max price + ESPN form gates for Dangerfield");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

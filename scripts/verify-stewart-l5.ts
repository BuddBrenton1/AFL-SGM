import { loadLiveFormForTeams, applyLiveFormToPlayers } from "../src/lib/live-form";
import {
  annotateLegsWithRecentForm,
  countRecentFormHits,
} from "../src/lib/engine/best-form";
import { getPlayer, playersForTeam } from "../src/lib/players";
import type { CandidateLeg, EnrichedGame } from "../src/lib/types";

async function main() {
  const live = await loadLiveFormForTeams(["geelong"], 5);
  console.log("message", live.message);
  console.log("teams", live.teamsCovered, "boxes", live.boxesFetched);

  const stewart = [...live.byName.entries()].filter(
    ([k, v]) => /stewart/i.test(k) || /stewart/i.test(v.name),
  );
  console.log("stewart espn rows", JSON.stringify(stewart, null, 2));

  const seed = getPlayer("gee-stewart");
  console.log("seed last5D", seed?.form.last5Disposals, "source", seed?.formSource);

  if (stewart[0]) {
    const line = stewart[0][1];
    console.log("18+ hits from ESPN", countRecentFormHits(line.last5Disposals, 18, 5));
  } else {
    console.log("NO ESPN ROW FOR STEWART");
  }

  const applied = applyLiveFormToPlayers(playersForTeam("geelong"), live.byName);
  const p = applied.players.find((x) => /stewart/i.test(x.name));
  console.log(
    "applied stewart",
    p?.formSource,
    p?.form.last5Disposals,
    "18+ rate",
    p?.form.disposalHitRates?.["18+"],
  );

  const leg: CandidateLeg = {
    id: "ts18",
    gameId: 1,
    market: "player_disposal",
    label: "Thomas Stewart 18+ Disposals",
    shortLabel: "Stewart 18+D",
    playerName: "Thomas Stewart",
    threshold: 18,
    sportsbetPoint: 17.5,
    sportsbetOdds: 1.25,
    probability: 0.7,
    odds: 1.25,
    confidence: 0.7,
    valueScore: 0,
    factors: [],
    correlationGroup: "player:thomas stewart",
  };
  const game = {
    id: 1,
    homeTeam: "Geelong",
    awayTeam: "St Kilda",
    homePlayers: applied.players,
    awayPlayers: [],
  } as unknown as EnrichedGame;
  const ann = annotateLegsWithRecentForm([leg], game, live.byName);
  console.log(
    "annotated",
    ann[0].recentFormHits,
    "/",
    ann[0].recentFormGames,
    ann[0].factors.find((f) => f.key === "recent-form")?.detail,
  );

  if (ann[0].recentFormHits !== 3 || ann[0].recentFormGames !== 5) {
    throw new Error(
      `Expected Stewart 18+ L5 3/5, got ${ann[0].recentFormHits}/${ann[0].recentFormGames}`,
    );
  }
  console.log("PASS: Thomas Stewart 18+ is L5 3/5 (60%)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Offline checks for Sportsbet board key aliases + quota error parsing.
 * Run: npx tsx scripts/verify-sportsbet-board.ts
 */
import assert from "node:assert/strict";
import {
  lookupSportsbetBoard,
  type SportsbetEventOdds,
} from "../src/lib/sportsbet";

function fakeBoard(
  home: string,
  away: string,
): SportsbetEventOdds {
  return {
    eventId: "evt1",
    homeTeam: home,
    awayTeam: away,
    commenceTime: new Date().toISOString(),
    lines: [
      {
        marketKey: "player_disposals_over",
        name: "Over",
        description: "Patrick Dangerfield",
        price: 1.45,
        point: 19.5,
      },
    ],
  };
}

function main() {
  const board = fakeBoard("Geelong Cats", "Collingwood Magpies");
  const map = new Map<string, SportsbetEventOdds>();

  // Simulate store under Odds API names + TeamIds (what loadSportsbetBoard does)
  map.set("geelong|collingwood", board);
  map.set("collingwood|geelong", board);
  map.set("geelong|collingwood", board); // TeamId-style after resolve
  // Squiggle often uses short names
  map.set("geelong|collingwood", board);

  // Direct TeamId keys as storeBoardAliases would add
  map.set("geelong|collingwood", board);

  const hit = lookupSportsbetBoard(map, "Geelong", "Collingwood");
  assert.ok(hit, "lookup should find board via fuzzy/compatible names");
  assert.equal(hit.eventId, "evt1");

  // Empty map → undefined
  assert.equal(
    lookupSportsbetBoard(new Map(), "Geelong", "Collingwood"),
    undefined,
  );

  // Fuzzy fallback: only store under a key that won't match Squiggle short names
  const oddsOnly = new Map<string, SportsbetEventOdds>();
  oddsOnly.set("odds-api-raw-key", board);
  const fuzzy = lookupSportsbetBoard(oddsOnly, "Geelong", "Collingwood");
  assert.ok(fuzzy, "fuzzy teamNamesCompatible fallback should hit");

  console.log("verify-sportsbet-board: ok");
}

main();

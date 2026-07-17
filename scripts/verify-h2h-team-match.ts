/**
 * Guards the Melbourne ⊆ North Melbourne H2H price bug.
 * Run: npx --yes tsx scripts/verify-h2h-team-match.ts
 */
import assert from "node:assert/strict";
import { resolveTeamIdLoose } from "../src/lib/teams";
import {
  findH2hPriceForMatchup,
  type MatchH2hPrice,
} from "../src/lib/sportsbet";

const north = resolveTeamIdLoose("North Melbourne");
const melb = resolveTeamIdLoose("Melbourne");
const northRoo = resolveTeamIdLoose("Kangaroos");
const demons = resolveTeamIdLoose("Demons");

assert.equal(north, "northmelbourne");
assert.equal(melb, "melbourne");
assert.notEqual(north, melb);
assert.equal(northRoo, "northmelbourne");
assert.equal(demons, "melbourne");

// Longest-alias: "North Melbourne Kangaroos" must not collapse to Melbourne
assert.equal(resolveTeamIdLoose("North Melbourne Kangaroos"), "northmelbourne");

const prices: MatchH2hPrice[] = [
  {
    homeTeam: "North Melbourne",
    awayTeam: "Melbourne",
    homeTeamId: "northmelbourne",
    awayTeamId: "melbourne",
    homeOdds: 2.89,
    awayOdds: 1.42,
  },
  {
    homeTeam: "Carlton",
    awayTeam: "Collingwood",
    homeTeamId: "carlton",
    awayTeamId: "collingwood",
    homeOdds: 1.9,
    awayOdds: 1.9,
  },
];

const hit = findH2hPriceForMatchup(
  prices,
  "North Melbourne",
  "Melbourne",
  "northmelbourne",
  "melbourne",
);
assert.ok(hit, "should find North vs Melbourne H2H");
assert.equal(hit.homeOdds, 2.89);
assert.equal(hit.awayOdds, 1.42);

// Swapped Squiggle orientation still resolves
const swapped = findH2hPriceForMatchup(
  prices,
  "Melbourne",
  "North Melbourne",
  "melbourne",
  "northmelbourne",
);
assert.ok(swapped);
assert.equal(swapped.homeOdds, 2.89);
assert.equal(swapped.awayOdds, 1.42);

// Simulate Odds API outcome picking: must not assign Melbourne price to both
type Line = { name: string; price: number };
const h2h: Line[] = [
  { name: "North Melbourne", price: 2.89 },
  { name: "Melbourne", price: 1.42 },
];
const pick = (teamId: string) =>
  h2h.find((l) => resolveTeamIdLoose(l.name) === teamId);
const homeLine = pick("northmelbourne");
const awayLine = pick("melbourne");
assert.ok(homeLine && awayLine);
assert.notEqual(homeLine, awayLine);
assert.equal(homeLine.price, 2.89);
assert.equal(awayLine.price, 1.42);

console.log("verify-h2h-team-match: OK");

/**
 * Guards AFL roster name parsing for guernsey numbers.
 * Run: npx --yes tsx scripts/verify-guernsey-names.ts
 */
import assert from "node:assert/strict";
import {
  fetchAflMatchRefs,
  fetchClubGuernseysFromLatestMatch,
} from "../src/lib/afl-lineups";

async function main() {
  const { resolveTeamId, resolveTeamIdLoose } = await import("../src/lib/teams");
  assert.equal(resolveTeamId("westcoast"), "westcoast");
  assert.equal(resolveTeamIdLoose("westcoast"), "westcoast");
  assert.equal(resolveTeamId("WCE"), "westcoast");
  assert.equal(resolveTeamId("West Coast Eagles"), "westcoast");

  const refs = await fetchAflMatchRefs(2026);
  assert.ok(refs.length > 20, "expected season match refs");

  const wce = await fetchClubGuernseysFromLatestMatch(refs, "westcoast");
  const bri = await fetchClubGuernseysFromLatestMatch(refs, "brisbane");

  console.log("WCE guernseys", wce.length, wce.slice(0, 5));
  console.log("BRI guernseys", bri.length, bri.slice(0, 5));

  assert.ok(wce.length >= 18, `WCE sheet too thin (${wce.length})`);
  assert.ok(bri.length >= 18, `BRI sheet too thin (${bri.length})`);

  const reid = wce.find((g) => /harley reid/i.test(g.name));
  const duggan = wce.find((g) => /liam duggan/i.test(g.name));
  const morris = bri.find((g) => /logan morris/i.test(g.name));
  const dunkley = bri.find((g) => /josh dunkley/i.test(g.name));

  assert.ok(reid, "Harley Reid missing from WCE guernseys");
  assert.equal(reid.jumper, 9);
  assert.ok(duggan, "Liam Duggan missing");
  assert.equal(duggan.jumper, 14);
  assert.ok(morris, "Logan Morris missing");
  assert.equal(morris.jumper, 13);
  assert.ok(dunkley, "Josh Dunkley missing");
  assert.equal(dunkley.jumper, 5);

  console.log("verify-guernsey-names: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

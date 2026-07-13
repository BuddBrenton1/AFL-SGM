import assert from "node:assert/strict";
import {
  PAPER_STARTING_CASH,
  summarizePaperBankroll,
} from "../src/lib/paper-bankroll";
import type { SavedSgm } from "../src/lib/saved-sgm";

function base(partial: Partial<SavedSgm>): SavedSgm {
  return {
    id: partial.id ?? "1",
    savedAt: "2026-07-13T00:00:00.000Z",
    multiId: partial.multiId ?? "m1",
    gameId: 1,
    matchup: "A vs B",
    venue: "MCG",
    round: 1,
    combinedOdds: partial.combinedOdds ?? 10,
    confidence: 0.8,
    legs: [],
    gameStatus: { complete: 0, homeTeam: "A", awayTeam: "B" },
    legResults: [],
    multiOutcome: partial.multiOutcome ?? "pending",
    stake: partial.stake,
  };
}

const open = base({ id: "a", stake: 100, multiOutcome: "pending" });
const won = base({
  id: "b",
  stake: 50,
  combinedOdds: 4,
  multiOutcome: "won",
});
const lost = base({ id: "c", stake: 25, multiOutcome: "lost" });
const voided = base({ id: "d", stake: 40, multiOutcome: "void" });
const watch = base({ id: "e", multiOutcome: "pending" });

const s = summarizePaperBankroll(
  [open, won, lost, voided, watch],
  PAPER_STARTING_CASH,
);

// starting 10000
// open locks 100
// won: +150 profit (50*4 - 50)
// lost: -25
// void: 0
// available = 10000 + 150 - 25 - 100 = 10025
assert.equal(s.openStake, 100);
assert.equal(s.realizedPnl, 125);
assert.equal(s.availableCash, 10025);
assert.equal(s.equity, 10125);
assert.equal(s.openCount, 1);
assert.equal(s.settledCount, 3);
assert.equal(s.watchCount, 1);

console.log("PASS: paper bankroll math");

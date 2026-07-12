/**
 * Quick matching checks for Sportsbet line selection.
 * Run: npx --yes tsx scripts/check-sportsbet-match.ts
 */
import assert from "node:assert/strict";

// Inline copies of the critical matchers (kept in sync with src/lib/sportsbet.ts)
function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function playerNamesMatch(a: string, b: string): boolean {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const aParts = na.split(" ").filter(Boolean);
  const bParts = nb.split(" ").filter(Boolean);
  if (aParts.length < 2 || bParts.length < 2) return false;
  const aFirst = aParts[0];
  const bFirst = bParts[0];
  const aLast = aParts[aParts.length - 1];
  const bLast = bParts[bParts.length - 1];
  if (aFirst === bFirst && aLast === bLast) return true;
  if (aLast === bLast && aFirst[0] === bFirst[0] && (aFirst.length === 1 || bFirst.length === 1)) {
    return true;
  }
  return false;
}

function pointMatchesThreshold(point: number | undefined, threshold: number): boolean {
  if (point == null || !Number.isFinite(point)) return false;
  return [threshold - 0.5, threshold].some((p) => Math.abs(point - p) < 0.05);
}

type Line = {
  marketKey: string;
  name: string;
  description?: string;
  price: number;
  point?: number;
};

function findPlayerOverLine(
  lines: Line[],
  marketKeys: string[],
  playerName: string,
  threshold: number,
): Line | null {
  const candidates = lines.filter((l) => {
    if (!marketKeys.includes(l.marketKey)) return false;
    if (!l.description || !playerNamesMatch(l.description, playerName)) return false;
    const n = l.name.toLowerCase().trim();
    if (!(n === "over" || n === "yes" || n.startsWith("over "))) return false;
    return pointMatchesThreshold(l.point, threshold);
  });
  const half = candidates.find(
    (l) => l.point != null && Math.abs(l.point - (threshold - 0.5)) < 0.05,
  );
  return half ?? candidates[0] ?? null;
}

const parishLines: Line[] = [
  { marketKey: "player_marks_over", name: "Over", description: "Darcy Parish", price: 1.11, point: 1.5 },
  { marketKey: "player_marks_over", name: "Over", description: "Darcy Parish", price: 1.4, point: 2.5 },
  { marketKey: "player_marks_over", name: "Over", description: "Darcy Parish", price: 2.15, point: 3.5 },
  { marketKey: "player_marks_over", name: "Over", description: "Zach Merrett", price: 1.2, point: 3.5 },
];

const hit = findPlayerOverLine(parishLines, ["player_marks_over"], "Darcy Parish", 4);
assert.ok(hit, "should find Parish 4+ marks");
assert.equal(hit.point, 3.5);
assert.equal(hit.price, 2.15);

const wrong = findPlayerOverLine(parishLines, ["player_marks_over"], "Darcy Parish", 2);
assert.equal(wrong?.point, 1.5);
assert.equal(wrong?.price, 1.11);

assert.equal(playerNamesMatch("Darcy Parish", "Zach Merrett"), false);
assert.equal(playerNamesMatch("D Parish", "Darcy Parish"), true);

console.log("sportsbet match checks passed");

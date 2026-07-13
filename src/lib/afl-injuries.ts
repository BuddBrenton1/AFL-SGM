import type { TeamId, TeamInsOuts } from "./types";

export interface AflInjuryRow {
  team: TeamId;
  player: string;
  injury: string;
  returnEstimate: string;
}

const BADGE_TO_TEAM: Record<string, TeamId> = {
  ADEL: "adelaide",
  ADE: "adelaide",
  BRIS: "brisbane",
  BL: "brisbane",
  BRI: "brisbane",
  CARL: "carlton",
  COLL: "collingwood",
  ESS: "essendon",
  FREM: "fremantle",
  FRE: "fremantle",
  GEEL: "geelong",
  GCS: "goldcoast",
  GCFC: "goldcoast",
  GWS: "gws",
  HAW: "hawthorn",
  MELB: "melbourne",
  NM: "northmelbourne",
  NMFC: "northmelbourne",
  PA: "portadelaide",
  PORT: "portadelaide",
  RICH: "richmond",
  STK: "stkilda",
  SYD: "sydney",
  WCE: "westcoast",
  WC: "westcoast",
  WB: "westernbulldogs",
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function badgeCodeFromContext(before: string): string | null {
  const m =
    before.match(
      /Straps-Badge[^"' ]*_(ADEL|ADE|BRIS|BL|BRI|CARL|COLL|ESS|FREM|FRE|GEEL|GCS|GCFC|GWS|HAW|MELB|NM|NMFC|PA|PORT|RICH|STK|SYD|WCE|WC|WB)[_-]/i,
    ) ??
    before.match(
      /_(ADEL|ADE|BRIS|BL|BRI|CARL|COLL|ESS|FREM|FRE|GEEL|GCS|GCFC|GWS|HAW|MELB|NM|NMFC|PA|PORT|RICH|STK|SYD|WCE|WC|WB)_(?:FA|1x)/i,
    );
  return m?.[1]?.toUpperCase() ?? null;
}

/** Parse official AFL.com.au injury list HTML into per-club rows. */
export function parseAflInjuryHtml(html: string): AflInjuryRow[] {
  const rows: AflInjuryRow[] = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(html))) {
    const table = match[0];
    const before = html.slice(Math.max(0, match.index - 1500), match.index);
    const code = badgeCodeFromContext(before);
    const team = code ? BADGE_TO_TEAM[code] : undefined;
    if (!team) continue;

    const trRe = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(table))) {
      const cells = [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
        (c) => stripHtml(c[1]),
      );
      if (cells.length < 3) continue;
      if (!cells[0] || cells[0].toUpperCase() === "PLAYER") continue;
      rows.push({
        team,
        player: cells[0],
        injury: cells[1] || "Injured",
        returnEstimate: cells[2] || "TBC",
      });
    }
  }
  return rows;
}

export async function fetchAflInjuryRows(): Promise<AflInjuryRow[]> {
  const res = await fetch("https://www.afl.com.au/matches/injury-list", {
    headers: {
      Accept: "text/html",
      "User-Agent":
        "BounceSGM/1.0 (https://github.com/bounce-sgm; AFL SGM scanner)",
    },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`AFL injury list HTTP ${res.status}`);
  }
  const html = await res.text();
  return parseAflInjuryHtml(html);
}

export function injuryRowsToInsOuts(
  team: TeamId,
  rows: AflInjuryRow[],
): TeamInsOuts {
  const club = rows.filter((r) => r.team === team);
  if (!club.length) {
    return {
      team,
      ins: [],
      outs: [],
      notes: ["No current injuries listed on AFL.com.au"],
    };
  }

  const outs = club.map((r) => `${r.player} (${r.injury})`);
  const notes = club
    .slice(0, 4)
    .map((r) => `${r.player}: ${r.injury} — return ${r.returnEstimate}`);
  notes.push("Source: AFL.com.au official injury list");

  return { team, ins: [], outs, notes };
}

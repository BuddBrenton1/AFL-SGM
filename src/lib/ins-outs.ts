import type { TeamId, TeamInsOuts } from "./types";
import { injuryRowsToInsOuts, type AflInjuryRow } from "./afl-injuries";

/** Latest team lists — illustrative mid-week movements used only as fallback. */
const INS_OUTS: Partial<Record<TeamId, Omit<TeamInsOuts, "team">>> = {
  melbourne: {
    ins: ["Jake Melksham", "Harrison Petty"],
    outs: ["Steven May (injured)", "Tom Sparrow"],
    notes: [
      "May out lifts contested marking load on defenders",
      "Melksham return boosts forward-half pressure & goals",
    ],
  },
  richmond: {
    ins: ["Rhyan Mansell", "Jacob Bauer"],
    outs: ["Dustin Martin (managed)", "Noah Balta"],
    notes: [
      "Martin managed — Bolton/Mansell absorb creative load",
      "Thin midfield increases tackle opportunity for opposition",
    ],
  },
  brisbane: {
    ins: ["Oscar McInerney", "Kai Lohmann"],
    outs: ["Harris Andrews (corked)", "Callum Ah Chee"],
    notes: [
      "Andrews out softens opposition key-forward ceiling slightly",
      "Neale/Dunkley still drive disposal floors",
    ],
  },
  essendon: {
    ins: ["Jake Stringer", "Sam Durham"],
    outs: ["Sam Draper (injured)", "Andrew McGrath"],
    notes: [
      "Draper out — hitout disadvantage, more ground-ball scrap",
      "Stringer in lifts goal markets at the Gabba",
    ],
  },
  geelong: {
    ins: ["Tyson Stengle", "Shannon Neale"],
    outs: ["Gary Rohan", "Oli Dempsey"],
    notes: ["Cameron remains primary goal threat at Kardinia"],
  },
  stkilda: {
    ins: ["Max King", "Mitch Owens"],
    outs: ["Anthony Caminiti", "Bradley Hill (suspended)"],
    notes: [
      "Hill suspension opens wing disposals for Wanganeen-Milera",
      "King confirmed — 1+ goals a core leg",
    ],
  },
  sydney: {
    ins: ["Logan McDonald", "Brodie Grundy"],
    outs: ["Tom Papley (injured)", "Dane Rampe"],
    notes: [
      "Papley out concentrates forward entries to McDonald/Heeney",
      "Gulden disposal floor remains elite at SCG",
    ],
  },
  adelaide: {
    ins: ["Riley Thilthorpe", "Izak Rankine"],
    outs: ["Darcy Fogarty (injured)", "Brodie Smith"],
    notes: ["Fogarty out — Thilthorpe/Walker share the goal load"],
  },
  portadelaide: {
    ins: ["Mitch Georgiades", "Jason Horne-Francis"],
    outs: ["Charlie Dixon (managed)", "Todd Marshall"],
    notes: ["Dixon managed — Georgiades primary marking target"],
  },
  fremantle: {
    ins: ["Josh Treacy", "Michael Frederick"],
    outs: ["Jye Amiss (injured)", "Brennan Cox"],
    notes: ["Amiss out consolidates Treacy as spearhead"],
  },
  northmelbourne: {
    ins: ["Nick Larkey", "George Wardlaw"],
    outs: ["Jy Simpkin (injured)", "Jackson Archer"],
    notes: [
      "Simpkin out — Sheezel absorbs extra mid possessions",
      "Larkey confirmed for Docklands",
    ],
  },
  collingwood: {
    ins: ["Jamie Elliott", "Beau McCreery"],
    outs: ["Bobby Hill (injured)", "Reef McInnes"],
    notes: ["Hill out — Elliott goal share rises vs Carlton"],
  },
  carlton: {
    ins: ["Charlie Curnow", "Adam Cerra"],
    outs: ["Corey Durdin", "Jordan Boyd"],
    notes: ["Curnow/McKay twin towers vs Pies defence"],
  },
  westcoast: {
    ins: ["Jake Waterman", "Harley Reid"],
    outs: ["Oscar Allen (injured)", "Jamie Cripps (managed)"],
    notes: ["Allen out — Waterman is the clear 1+ / 2+ focus"],
  },
  hawthorn: {
    ins: ["Jack Ginnivan", "Mabior Chol"],
    outs: ["Luke Breust (managed)", "Josh Weddle"],
    notes: ["Breust managed — Ginnivan/Moore goal markets preferred"],
  },
  goldcoast: {
    ins: ["Ben King", "Wil Powell"],
    outs: ["Mac Andrew", "Ben Long"],
    notes: ["King at Carrara is a cornerstone SGM goal leg"],
  },
  westernbulldogs: {
    ins: ["Aaron Naughton", "Rory Lobb"],
    outs: ["Jamarra Ugle-Hagan (injured)", "Buku Khamis"],
    notes: ["UGH out — Naughton/Weightman soak forward entries"],
  },
  gws: {
    ins: ["Jesse Hogan", "Toby Greene"],
    outs: ["Jake Riccardi", "Harry Himmelberg (omitted)"],
    notes: ["Hogan + Greene both named — correlated goal stack risk"],
  },
};

export function getStaticInsOuts(team: TeamId): TeamInsOuts {
  const row = INS_OUTS[team];
  if (!row) {
    return { team, ins: [], outs: [], notes: ["No late changes flagged"] };
  }
  return { team, ...row };
}

/** @deprecated Prefer resolveInsOuts with live injury/lineup feeds. */
export function getInsOuts(team: TeamId): TeamInsOuts {
  return getStaticInsOuts(team);
}

/**
 * Prefer official team sheet ins/outs, else AFL injury list, else static fallback.
 */
export function resolveInsOuts(opts: {
  team: TeamId;
  lineup?: TeamInsOuts | null;
  injuries?: AflInjuryRow[];
}): TeamInsOuts {
  const { team, lineup, injuries } = opts;
  if (lineup && (lineup.ins.length > 0 || lineup.outs.length > 0)) {
    if (injuries?.length) {
      const injury = injuryRowsToInsOuts(team, injuries);
      const existing = new Set(
        lineup.outs.map((o) => o.split("(")[0]?.trim().toLowerCase()),
      );
      const extraOuts = injury.outs.filter((o) => {
        const name = o.split("(")[0]?.trim().toLowerCase();
        return name && !existing.has(name);
      });
      if (extraOuts.length) {
        return {
          ...lineup,
          outs: [...lineup.outs, ...extraOuts],
          notes: [
            ...lineup.notes,
            ...extraOuts.slice(0, 2).map((o) => `Also injured: ${o}`),
          ],
        };
      }
    }
    return lineup;
  }

  if (injuries?.length) {
    const live = injuryRowsToInsOuts(team, injuries);
    if (live.outs.length) return live;
  }

  return getStaticInsOuts(team);
}

export function isPlayerNamed(
  playerName: string,
  insOuts: TeamInsOuts,
): { named: boolean; reason?: string } {
  const needle = playerName.toLowerCase();
  const outHit = insOuts.outs.find((o) => {
    const base = o.split("(")[0]?.trim().toLowerCase() ?? "";
    return base === needle || o.toLowerCase().startsWith(needle);
  });
  if (outHit) return { named: false, reason: outHit };
  return { named: true };
}

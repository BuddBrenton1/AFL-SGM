import type { PlayerProfile, PlayerRole, PlayerSeasonForm, TeamId } from "./types";

type FormInput = Partial<PlayerSeasonForm> & {
  goalsAvg: number;
  disposalsAvg: number;
};

type BuiltForm = PlayerSeasonForm & {
  /** False when marksAvg was only inferred from disposals (unreliable for mids). */
  marksExplicit: boolean;
  /** False when last5Tackles / tacklesAvg were inferred from disposals. */
  tacklesExplicit: boolean;
};

function form(partial: FormInput): BuiltForm {
  const g = partial.goalsAvg;
  const d = partial.disposalsAvg;
  const marksExplicit = partial.marksAvg != null;
  const tacklesExplicit = partial.last5Tackles != null;
  // Contested mids dispose a lot without marking — never invent ~6 marks from 28 disposals.
  const m = partial.marksAvg ?? Math.max(2, Math.min(3.5, d * 0.11));
  const t = partial.tacklesAvg ?? Math.max(2, d * 0.18);
  const last5Goals = partial.last5Goals ?? [
    Math.max(0, Math.round(g + 1)),
    Math.max(0, Math.round(g)),
    Math.max(0, Math.round(g - 0.5)),
    Math.max(0, Math.round(g + 0.5)),
    Math.max(0, Math.round(g)),
  ];
  const last5Disposals = partial.last5Disposals ?? [
    Math.round(d + 4),
    Math.round(d - 2),
    Math.round(d + 1),
    Math.round(d - 1),
    Math.round(d + 2),
  ];
  return {
    games: partial.games ?? 16,
    goalsAvg: g,
    disposalsAvg: d,
    marksAvg: m,
    tacklesAvg: t,
    hitoutsAvg: partial.hitoutsAvg ?? 0,
    homeGoalsAvg: partial.homeGoalsAvg ?? g * 1.08,
    awayGoalsAvg: partial.awayGoalsAvg ?? g * 0.92,
    homeDisposalsAvg: partial.homeDisposalsAvg ?? d * 1.05,
    awayDisposalsAvg: partial.awayDisposalsAvg ?? d * 0.95,
    last5Goals,
    last5Disposals,
    last5Marks:
      partial.last5Marks ?? last5Disposals.map((x) => Math.round(x * 0.11)),
    last5Tackles:
      partial.last5Tackles ?? last5Disposals.map((x) => Math.round(x * 0.16)),
    goalHitRates: partial.goalHitRates ?? {
      "1+": Math.min(0.95, 0.35 + g * 0.28),
      "2+": Math.min(0.85, 0.12 + g * 0.22),
      "3+": Math.min(0.65, 0.04 + g * 0.14),
    },
    disposalHitRates: partial.disposalHitRates ?? {
      "15+": Math.min(0.98, 0.2 + d * 0.035),
      "20+": Math.min(0.95, 0.05 + d * 0.032),
      "25+": Math.min(0.9, Math.max(0.05, (d - 18) * 0.06)),
      "30+": Math.min(0.8, Math.max(0.03, (d - 24) * 0.07)),
    },
    marksExplicit,
    tacklesExplicit,
  };
}

function p(
  id: string,
  name: string,
  team: TeamId,
  role: PlayerRole,
  jumper: number,
  f: BuiltForm,
  roleStability = 0.9,
): PlayerProfile {
  const { marksExplicit, tacklesExplicit, ...seasonForm } = f;
  return {
    id,
    name,
    team,
    role,
    jumper,
    form: seasonForm,
    roleStability,
    marksExplicit,
    tacklesExplicit,
    formSource: "seed",
  };
}

/** Key SGM candidates per club — form tuned to mid-2026 ladder context. */
export const PLAYERS: PlayerProfile[] = [
  // Fremantle
  p("fre-banfield", "Bailey Banfield", "fremantle", "medium-forward", 41, form({ goalsAvg: 1.6, disposalsAvg: 14, marksAvg: 5, last5Goals: [2, 1, 3, 2, 1] })),
  p("fre-aish", "James Aish", "fremantle", "midfielder", 11, form({ goalsAvg: 0.4, disposalsAvg: 26, last5Disposals: [28, 24, 31, 22, 27] })),
  p("fre-serong", "Caleb Serong", "fremantle", "midfielder", 3, form({ goalsAvg: 0.5, disposalsAvg: 31, last5Disposals: [34, 29, 33, 28, 32], disposalHitRates: { "20+": 0.97, "25+": 0.9, "30+": 0.72 } })),
  p("fre-jackson", "Luke Jackson", "fremantle", "ruck", 13, form({ goalsAvg: 0.8, disposalsAvg: 18, hitoutsAvg: 28, marksAvg: 5 })),
  p("fre-treacy", "Josh Treacy", "fremantle", "key-forward", 35, form({ goalsAvg: 2.4, disposalsAvg: 12, marksAvg: 6, last5Goals: [3, 2, 4, 1, 3], goalHitRates: { "1+": 0.92, "2+": 0.72, "3+": 0.45 } })),

  // Sydney
  p("syd-franklin", "Lance Franklin", "sydney", "key-forward", 23, form({ goalsAvg: 1.8, disposalsAvg: 11, marksAvg: 5, games: 12, last5Goals: [2, 1, 3, 2, 0] }), 0.75),
  p("syd-heeney", "Isaac Heeney", "sydney", "midfielder", 5, form({ goalsAvg: 1.3, disposalsAvg: 24, last5Goals: [2, 1, 1, 2, 1], last5Disposals: [26, 22, 28, 21, 25] })),
  p("syd-gulden", "Errol Gulden", "sydney", "midfielder", 21, form({ goalsAvg: 0.7, disposalsAvg: 28, last5Disposals: [30, 26, 32, 25, 29] })),
  p("syd-warner", "Chad Warner", "sydney", "midfielder", 1, form({ goalsAvg: 0.9, disposalsAvg: 25, last5Disposals: [27, 23, 29, 24, 26] })),
  p("syd-mcdonald", "Logan McDonald", "sydney", "key-forward", 6, form({ goalsAvg: 2.1, disposalsAvg: 11, marksAvg: 6, last5Goals: [3, 2, 1, 3, 2] })),

  // Hawthorn
  p("haw-breust", "Luke Breust", "hawthorn", "medium-forward", 22, form({ goalsAvg: 1.5, disposalsAvg: 12, last5Goals: [2, 1, 2, 0, 2] }), 0.8),
  p("haw-newcombe", "Jai Newcombe", "hawthorn", "midfielder", 3, form({ goalsAvg: 0.5, disposalsAvg: 27, last5Disposals: [29, 25, 31, 24, 28] })),
  p("haw-ward", "Josh Ward", "hawthorn", "midfielder", 25, form({ goalsAvg: 0.4, disposalsAvg: 24 })),
  p("haw-ginnivan", "Jack Ginnivan", "hawthorn", "medium-forward", 10, form({ goalsAvg: 1.7, disposalsAvg: 15, last5Goals: [2, 3, 1, 2, 1] })),
  p("haw-moore", "Dylan Moore", "hawthorn", "medium-forward", 13, form({ goalsAvg: 1.4, disposalsAvg: 18, last5Goals: [1, 2, 1, 2, 2] })),

  // Adelaide
  p("ade-walker", "Taylor Walker", "adelaide", "key-forward", 13, form({ goalsAvg: 2.0, disposalsAvg: 10, marksAvg: 5, last5Goals: [3, 1, 2, 3, 2] }), 0.82),
  p("ade-dawson", "Jordan Dawson", "adelaide", "midfielder", 12, form({ goalsAvg: 0.6, disposalsAvg: 27, last5Disposals: [30, 25, 28, 26, 29] })),
  p("ade-laird", "Rory Laird", "adelaide", "midfielder", 29, form({ goalsAvg: 0.3, disposalsAvg: 29, last5Disposals: [32, 27, 31, 26, 30] })),
  p("ade-thilthorpe", "Riley Thilthorpe", "adelaide", "key-forward", 7, form({ goalsAvg: 2.2, disposalsAvg: 12, marksAvg: 6, last5Goals: [2, 3, 2, 1, 4] })),
  p("ade-keays", "Ben Keays", "adelaide", "midfielder", 2, form({ goalsAvg: 0.8, disposalsAvg: 23 })),

  // Brisbane
  p("bri-daniher", "Joe Daniher", "brisbane", "key-forward", 3, form({ goalsAvg: 2.3, disposalsAvg: 13, marksAvg: 7, last5Goals: [3, 2, 4, 1, 3], goalHitRates: { "1+": 0.9, "2+": 0.7, "3+": 0.42 } })),
  p("bri-hipwood", "Eric Hipwood", "brisbane", "key-forward", 30, form({ goalsAvg: 1.8, disposalsAvg: 11, marksAvg: 5, last5Goals: [2, 1, 3, 2, 1] })),
  p("bri-neale", "Lachie Neale", "brisbane", "midfielder", 9, form({ goalsAvg: 0.5, disposalsAvg: 30, last5Disposals: [33, 28, 32, 27, 31], disposalHitRates: { "20+": 0.98, "25+": 0.92, "30+": 0.7 } })),
  p("bri-dunkley", "Josh Dunkley", "brisbane", "midfielder", 7, form({ goalsAvg: 0.4, disposalsAvg: 26, tacklesAvg: 7 })),
  p("bri-ashcroft", "Will Ashcroft", "brisbane", "midfielder", 8, form({ goalsAvg: 0.6, disposalsAvg: 25 })),
  p("bri-cameron", "Charlie Cameron", "brisbane", "medium-forward", 23, form({ goalsAvg: 1.9, disposalsAvg: 12, last5Goals: [2, 3, 1, 2, 2] })),

  // Melbourne
  p("mel-fritsche", "Bayley Fritsch", "melbourne", "medium-forward", 31, form({ goalsAvg: 2.0, disposalsAvg: 11, last5Goals: [3, 1, 2, 3, 2] })),
  p("mel-petridis", "Kysaiah Pickett", "melbourne", "medium-forward", 36, form({ goalsAvg: 1.8, disposalsAvg: 14, last5Goals: [2, 2, 1, 3, 2] })),
  p("mel-oliver", "Clayton Oliver", "melbourne", "midfielder", 13, form({ goalsAvg: 0.4, disposalsAvg: 29, last5Disposals: [31, 27, 33, 26, 30] })),
  p("mel-viney", "Jack Viney", "melbourne", "midfielder", 7, form({ goalsAvg: 0.3, disposalsAvg: 25, tacklesAvg: 7 })),
  p("mel-gawn", "Max Gawn", "melbourne", "ruck", 11, form({ goalsAvg: 0.6, disposalsAvg: 17, hitoutsAvg: 38, marksAvg: 6 })),
  p("mel-mcvey", "Jake Melksham", "melbourne", "medium-forward", 18, form({ goalsAvg: 1.4, disposalsAvg: 12, last5Goals: [2, 1, 1, 2, 2] }), 0.78),

  // Collingwood
  p("col-elliott", "Jamie Elliott", "collingwood", "medium-forward", 5, form({ goalsAvg: 2.1, disposalsAvg: 13, last5Goals: [3, 2, 2, 1, 3] })),
  p("col-miersk", "Darcy Moore", "collingwood", "defender", 30, form({ goalsAvg: 0.1, disposalsAvg: 16, marksAvg: 7 }), 0.85),
  p("col-pendlebury", "Scott Pendlebury", "collingwood", "midfielder", 10, form({ goalsAvg: 0.4, disposalsAvg: 24, last5Disposals: [26, 22, 27, 21, 25] }), 0.8),
  p("col-sidebottom", "Steele Sidebottom", "collingwood", "midfielder", 22, form({ goalsAvg: 0.5, disposalsAvg: 23 })),
  p("col-nicholls", "Brody Mihocek", "collingwood", "key-forward", 41, form({ goalsAvg: 1.7, disposalsAvg: 11, last5Goals: [2, 1, 3, 1, 2] })),
  p("col-daicos-n", "Nick Daicos", "collingwood", "midfielder", 35, form({ goalsAvg: 0.7, disposalsAvg: 32, last5Disposals: [35, 30, 34, 28, 33], disposalHitRates: { "20+": 0.99, "25+": 0.95, "30+": 0.78 } })),
  p("col-daicos-j", "Josh Daicos", "collingwood", "wing", 7, form({ goalsAvg: 0.4, disposalsAvg: 26 })),

  // Geelong
  p("gee-cameron", "Jeremy Cameron", "geelong", "key-forward", 5, form({ goalsAvg: 2.6, disposalsAvg: 14, marksAvg: 7, last5Goals: [3, 4, 2, 3, 2], goalHitRates: { "1+": 0.94, "2+": 0.78, "3+": 0.5 } })),
  p("gee-close", "Brad Close", "geelong", "medium-forward", 45, form({ goalsAvg: 1.3, disposalsAvg: 16 })),
  p("gee-danger", "Patrick Dangerfield", "geelong", "midfielder", 35, form({
    goalsAvg: 0.8,
    disposalsAvg: 20,
    last5Disposals: [30, 22, 20, 17, 12],
    disposalHitRates: {
      "14+": 0.7,
      "15+": 0.7,
      "20+": 0.3,
      "25+": 0.12,
      "30+": 0.04,
    },
  }), 0.78),
  p("gee-stewart", "Tom Stewart", "geelong", "defender", 44, form({ goalsAvg: 0.1, disposalsAvg: 22, marksAvg: 7 })),
  p("gee-manning", "Tyson Stengle", "geelong", "medium-forward", 18, form({ goalsAvg: 1.9, disposalsAvg: 13, last5Goals: [2, 3, 1, 2, 2] })),
  p("gee-holmes", "Max Holmes", "geelong", "midfielder", 9, form({
    goalsAvg: 0.6,
    disposalsAvg: 27,
    last5Disposals: [31, 26, 29, 24, 28],
    disposalHitRates: { "15+": 0.98, "20+": 0.94, "25+": 0.78, "30+": 0.35 },
  })),

  // Western Bulldogs
  p("wbd-bont", "Marcus Bontempelli", "westernbulldogs", "midfielder", 4, form({ goalsAvg: 1.0, disposalsAvg: 29, last5Disposals: [31, 27, 33, 26, 30], last5Goals: [1, 2, 0, 1, 2] })),
  p("wbd-naughton", "Aaron Naughton", "westernbulldogs", "key-forward", 33, form({ goalsAvg: 2.2, disposalsAvg: 12, marksAvg: 6, last5Goals: [3, 2, 1, 3, 2] })),
  p("wbd-weightman", "Cody Weightman", "westernbulldogs", "medium-forward", 19, form({ goalsAvg: 1.6, disposalsAvg: 12, last5Goals: [2, 1, 2, 2, 1] })),
  p("wbd-libba", "Tom Liberatore", "westernbulldogs", "midfielder", 21, form({ goalsAvg: 0.4, disposalsAvg: 27, tacklesAvg: 7 })),
  p("wbd-english", "Tim English", "westernbulldogs", "ruck", 44, form({ goalsAvg: 0.7, disposalsAvg: 18, hitoutsAvg: 32 })),

  // St Kilda
  p("stk-king", "Max King", "stkilda", "key-forward", 12, form({ goalsAvg: 2.0, disposalsAvg: 11, marksAvg: 6, last5Goals: [2, 3, 1, 2, 3] })),
  p("stk-marshall", "Rowan Marshall", "stkilda", "ruck", 19, form({ goalsAvg: 0.6, disposalsAvg: 20, hitoutsAvg: 30 })),
  p("stk-steele", "Jack Steele", "stkilda", "midfielder", 9, form({ goalsAvg: 0.3, disposalsAvg: 26, tacklesAvg: 8 })),
  p("stk-butler", "Dan Butler", "stkilda", "medium-forward", 16, form({ goalsAvg: 1.4, disposalsAvg: 11 })),
  p("stk-wanganeen", "Nasiah Wanganeen-Milera", "stkilda", "defender", 7, form({ goalsAvg: 0.3, disposalsAvg: 25 })),

  // GWS
  p("gws-greene", "Toby Greene", "gws", "medium-forward", 4, form({ goalsAvg: 2.1, disposalsAvg: 16, last5Goals: [3, 2, 2, 1, 3] })),
  p("gws-hogan", "Jesse Hogan", "gws", "key-forward", 23, form({ goalsAvg: 2.5, disposalsAvg: 12, marksAvg: 7, last5Goals: [4, 2, 3, 2, 3], goalHitRates: { "1+": 0.93, "2+": 0.75, "3+": 0.48 } })),
  p("gws-kelly", "Josh Kelly", "gws", "midfielder", 22, form({ goalsAvg: 0.6, disposalsAvg: 27 })),
  p("gws-green", "Tom Green", "gws", "midfielder", 12, form({ goalsAvg: 0.5, disposalsAvg: 30, last5Disposals: [33, 28, 32, 27, 31] })),
  p("gws-cadman", "Aaron Cadman", "gws", "key-forward", 5, form({ goalsAvg: 1.5, disposalsAvg: 10, last5Goals: [2, 1, 2, 1, 2] })),

  // Carlton
  p("car-curnow", "Charlie Curnow", "carlton", "key-forward", 30, form({ goalsAvg: 2.4, disposalsAvg: 12, marksAvg: 7, last5Goals: [3, 2, 4, 1, 3], goalHitRates: { "1+": 0.92, "2+": 0.74, "3+": 0.46 } })),
  p("car-mcKay", "Harry McKay", "carlton", "key-forward", 10, form({ goalsAvg: 1.9, disposalsAvg: 12, marksAvg: 7, last5Goals: [2, 1, 3, 2, 2] })),
  p("car-cripps", "Patrick Cripps", "carlton", "midfielder", 9, form({ goalsAvg: 0.5, disposalsAvg: 28, last5Disposals: [30, 26, 32, 25, 29] })),
  p("car-walsh", "Sam Walsh", "carlton", "midfielder", 18, form({ goalsAvg: 0.4, disposalsAvg: 29, last5Disposals: [31, 27, 33, 26, 30] })),
  p("car-acree", "Jesse Motlop", "carlton", "medium-forward", 3, form({ goalsAvg: 1.3, disposalsAvg: 12 })),

  // North Melbourne
  p("nth-larkey", "Nick Larkey", "northmelbourne", "key-forward", 20, form({ goalsAvg: 2.0, disposalsAvg: 11, last5Goals: [2, 3, 1, 2, 2] })),
  p("nth-zurhaar", "Cameron Zurhaar", "northmelbourne", "medium-forward", 26, form({ goalsAvg: 1.5, disposalsAvg: 13 })),
  p("nth-simpk", "Jy Simpkin", "northmelbourne", "midfielder", 12, form({ goalsAvg: 0.5, disposalsAvg: 25 })),
  p("nth-xerra", "Harry Sheezel", "northmelbourne", "midfielder", 3, form({ goalsAvg: 0.5, disposalsAvg: 31, last5Disposals: [34, 29, 33, 28, 32], disposalHitRates: { "20+": 0.98, "25+": 0.93, "30+": 0.74 } })),
  p("nth-curtis", "Paul Curtis", "northmelbourne", "medium-forward", 25, form({ goalsAvg: 1.6, disposalsAvg: 12, last5Goals: [2, 1, 2, 2, 1] })),

  // Gold Coast
  p("gcs-king", "Ben King", "goldcoast", "key-forward", 34, form({ goalsAvg: 2.3, disposalsAvg: 10, marksAvg: 5, last5Goals: [3, 2, 4, 1, 3] })),
  p("gcs-anderson", "Noah Anderson", "goldcoast", "midfielder", 15, form({ goalsAvg: 0.5, disposalsAvg: 28, last5Disposals: [30, 26, 31, 25, 29] })),
  p("gcs-rowell", "Matt Rowell", "goldcoast", "midfielder", 18, form({ goalsAvg: 0.3, disposalsAvg: 26, tacklesAvg: 9 })),
  p("gcs-humphrey", "Sam Flanders", "goldcoast", "midfielder", 26, form({ goalsAvg: 0.6, disposalsAvg: 27 })),
  p("gcs-humphries", "Bailey Humphrey", "goldcoast", "medium-forward", 19, form({ goalsAvg: 1.4, disposalsAvg: 14 })),

  // Port Adelaide
  p("pta-dixon", "Charlie Dixon", "portadelaide", "key-forward", 22, form({ goalsAvg: 1.7, disposalsAvg: 11, last5Goals: [2, 1, 2, 1, 3] }), 0.75),
  p("pta-rozee", "Connor Rozee", "portadelaide", "midfielder", 10, form({ goalsAvg: 0.8, disposalsAvg: 27, last5Disposals: [29, 25, 30, 24, 28] })),
  p("pta-butters", "Zak Butters", "portadelaide", "midfielder", 9, form({ goalsAvg: 0.6, disposalsAvg: 28 })),
  p("pta-georgiades", "Mitch Georgiades", "portadelaide", "key-forward", 19, form({ goalsAvg: 2.0, disposalsAvg: 11, last5Goals: [3, 1, 2, 2, 3] })),
  p("pta-horne", "Willem Drew", "portadelaide", "midfielder", 28, form({ goalsAvg: 0.3, disposalsAvg: 22, tacklesAvg: 7 })),

  // West Coast
  p("wce-darcy", "Jamie Cripps", "westcoast", "medium-forward", 15, form({ goalsAvg: 1.4, disposalsAvg: 14, last5Goals: [2, 1, 1, 2, 1] })),
  p("wce-darcy2", "Jake Waterman", "westcoast", "key-forward", 2, form({ goalsAvg: 2.1, disposalsAvg: 12, marksAvg: 6, last5Goals: [3, 2, 2, 1, 3] })),
  p("wce-yeo", "Elliot Yeo", "westcoast", "midfielder", 6, form({ goalsAvg: 0.4, disposalsAvg: 24 }), 0.8),
  p("wce-kelly", "Tim Kelly", "westcoast", "midfielder", 11, form({ goalsAvg: 0.5, disposalsAvg: 26 })),
  p("wce-allen", "Oscar Allen", "westcoast", "key-forward", 12, form({ goalsAvg: 1.8, disposalsAvg: 10, last5Goals: [2, 1, 3, 2, 1] }), 0.72),

  // Richmond
  p("ric-bolton", "Shai Bolton", "richmond", "medium-forward", 29, form({ goalsAvg: 1.5, disposalsAvg: 18, last5Goals: [2, 1, 2, 1, 2] })),
  p("ric-lynch", "Tom Lynch", "richmond", "key-forward", 19, form({ goalsAvg: 1.6, disposalsAvg: 10, last5Goals: [2, 0, 2, 1, 2] }), 0.65),
  p("ric-mansell", "Rhyan Mansell", "richmond", "medium-forward", 31, form({ goalsAvg: 1.2, disposalsAvg: 12, last5Goals: [1, 2, 1, 1, 2] })),
  p("ric-taranto", "Tim Taranto", "richmond", "midfielder", 14, form({ goalsAvg: 0.5, disposalsAvg: 27, last5Disposals: [29, 24, 30, 25, 28] })),
  p("ric-green", "Toby Nankervis", "richmond", "ruck", 25, form({ goalsAvg: 0.3, disposalsAvg: 16, hitoutsAvg: 30, tacklesAvg: 4 })),
  p("ric-broad", "Nathan Broad", "richmond", "defender", 35, form({ goalsAvg: 0.1, disposalsAvg: 18, marksAvg: 6 })),

  // Essendon
  p("ess-stringer", "Jake Stringer", "essendon", "medium-forward", 25, form({ goalsAvg: 1.7, disposalsAvg: 13, last5Goals: [2, 1, 3, 1, 2] }), 0.75),
  p("ess-wright", "Peter Wright", "essendon", "key-forward", 20, form({ goalsAvg: 1.8, disposalsAvg: 11, last5Goals: [2, 2, 1, 3, 1] })),
  p("ess-parish", "Darcy Parish", "essendon", "midfielder", 3, form({ goalsAvg: 0.4, disposalsAvg: 28, last5Disposals: [30, 25, 31, 26, 29] }), 0.7),
  p("ess-merrett", "Zach Merrett", "essendon", "midfielder", 7, form({ goalsAvg: 0.5, disposalsAvg: 29, last5Disposals: [32, 27, 30, 26, 31] })),
  p("ess-martin", "Nic Martin", "essendon", "wing", 24, form({ goalsAvg: 0.6, disposalsAvg: 26 })),
  p("ess-duursma", "Xavier Duursma", "essendon", "midfielder", 28, form({ goalsAvg: 0.4, disposalsAvg: 22 })),
];

// Fix duplicate Martin entry - remove the bad duplicate
const seen = new Set<string>();
export const PLAYER_POOL: PlayerProfile[] = PLAYERS.filter((player) => {
  if (seen.has(player.id)) return false;
  seen.add(player.id);
  // remove accidental duplicate ric-ralph
  if (player.id === "ric-ralph") return false;
  return true;
});

export function playersForTeam(team: TeamId): PlayerProfile[] {
  return PLAYER_POOL.filter((p) => p.team === team);
}

export function getPlayer(id: string): PlayerProfile | undefined {
  return PLAYER_POOL.find((p) => p.id === id);
}

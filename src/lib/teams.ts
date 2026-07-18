import type { TeamId } from "./types";

export interface TeamMeta {
  id: TeamId;
  name: string;
  short: string;
  aliases: string[];
  primaryVenue: string;
  state: string;
  colors: { primary: string; secondary: string };
}

export const TEAMS: Record<TeamId, TeamMeta> = {
  adelaide: {
    id: "adelaide",
    name: "Adelaide",
    short: "ADE",
    aliases: ["Adelaide", "Adelaide Crows", "Crows"],
    primaryVenue: "Adelaide Oval",
    state: "SA",
    colors: { primary: "#002B5C", secondary: "#E21937" },
  },
  brisbane: {
    id: "brisbane",
    name: "Brisbane Lions",
    short: "BRI",
    aliases: ["Brisbane Lions", "Brisbane", "Lions"],
    primaryVenue: "Gabba",
    state: "QLD",
    colors: { primary: "#A30046", secondary: "#FDBE57" },
  },
  carlton: {
    id: "carlton",
    name: "Carlton",
    short: "CAR",
    aliases: ["Carlton", "Blues"],
    primaryVenue: "Docklands",
    state: "VIC",
    colors: { primary: "#0E1E2D", secondary: "#FFFFFF" },
  },
  collingwood: {
    id: "collingwood",
    name: "Collingwood",
    short: "COL",
    aliases: ["Collingwood", "Magpies", "Pies"],
    primaryVenue: "M.C.G.",
    state: "VIC",
    colors: { primary: "#000000", secondary: "#FFFFFF" },
  },
  essendon: {
    id: "essendon",
    name: "Essendon",
    short: "ESS",
    aliases: ["Essendon", "Bombers"],
    primaryVenue: "Docklands",
    state: "VIC",
    colors: { primary: "#CC2031", secondary: "#000000" },
  },
  fremantle: {
    id: "fremantle",
    name: "Fremantle",
    short: "FRE",
    aliases: ["Fremantle", "Dockers", "Freo"],
    primaryVenue: "Perth Stadium",
    state: "WA",
    colors: { primary: "#2A1A54", secondary: "#FFFFFF" },
  },
  geelong: {
    id: "geelong",
    name: "Geelong",
    short: "GEE",
    aliases: ["Geelong", "Geelong Cats", "Cats"],
    primaryVenue: "Kardinia Park",
    state: "VIC",
    colors: { primary: "#001F3D", secondary: "#FFFFFF" },
  },
  goldcoast: {
    id: "goldcoast",
    name: "Gold Coast",
    short: "GCS",
    aliases: ["Gold Coast", "Gold Coast Suns", "Gold Coast SUNS", "Suns"],
    primaryVenue: "Carrara",
    state: "QLD",
    colors: { primary: "#E02112", secondary: "#FFD200" },
  },
  gws: {
    id: "gws",
    name: "Greater Western Sydney",
    short: "GWS",
    aliases: [
      "Greater Western Sydney",
      "GWS",
      "Giants",
      "GWS Giants",
      "GWS GIANTS",
    ],
    primaryVenue: "Sydney Showground",
    state: "NSW",
    colors: { primary: "#F47920", secondary: "#FFFFFF" },
  },
  hawthorn: {
    id: "hawthorn",
    name: "Hawthorn",
    short: "HAW",
    aliases: ["Hawthorn", "Hawks"],
    primaryVenue: "M.C.G.",
    state: "VIC",
    colors: { primary: "#4D2004", secondary: "#FBBF15" },
  },
  melbourne: {
    id: "melbourne",
    name: "Melbourne",
    short: "MEL",
    aliases: ["Melbourne", "Demons"],
    primaryVenue: "M.C.G.",
    state: "VIC",
    colors: { primary: "#0F1130", secondary: "#CC2031" },
  },
  northmelbourne: {
    id: "northmelbourne",
    name: "North Melbourne",
    short: "NTH",
    aliases: ["North Melbourne", "Kangaroos", "North"],
    primaryVenue: "Docklands",
    state: "VIC",
    colors: { primary: "#013B9F", secondary: "#FFFFFF" },
  },
  portadelaide: {
    id: "portadelaide",
    name: "Port Adelaide",
    short: "PTA",
    aliases: ["Port Adelaide", "Power", "Port"],
    primaryVenue: "Adelaide Oval",
    state: "SA",
    colors: { primary: "#008AAB", secondary: "#000000" },
  },
  richmond: {
    id: "richmond",
    name: "Richmond",
    short: "RIC",
    aliases: ["Richmond", "Tigers"],
    primaryVenue: "M.C.G.",
    state: "VIC",
    colors: { primary: "#FFD200", secondary: "#000000" },
  },
  stkilda: {
    id: "stkilda",
    name: "St Kilda",
    short: "STK",
    aliases: ["St Kilda", "Saints"],
    primaryVenue: "Docklands",
    state: "VIC",
    colors: { primary: "#ED0F05", secondary: "#FFFFFF" },
  },
  sydney: {
    id: "sydney",
    name: "Sydney",
    short: "SYD",
    aliases: ["Sydney", "Swans", "Sydney Swans"],
    primaryVenue: "S.C.G.",
    state: "NSW",
    colors: { primary: "#E62829", secondary: "#FFFFFF" },
  },
  westcoast: {
    id: "westcoast",
    name: "West Coast",
    short: "WCE",
    aliases: ["West Coast", "West Coast Eagles", "Eagles"],
    primaryVenue: "Perth Stadium",
    state: "WA",
    colors: { primary: "#003087", secondary: "#F2A900" },
  },
  westernbulldogs: {
    id: "westernbulldogs",
    name: "Western Bulldogs",
    short: "WBD",
    aliases: ["Western Bulldogs", "Bulldogs", "Dogs"],
    primaryVenue: "Docklands",
    state: "VIC",
    colors: { primary: "#014896", secondary: "#E51837" },
  },
};

const NAME_LOOKUP = new Map<string, TeamId>();
for (const team of Object.values(TEAMS)) {
  for (const alias of team.aliases) {
    NAME_LOOKUP.set(alias.toLowerCase(), team.id);
  }
}

export function resolveTeamId(name: string | null | undefined): TeamId | null {
  if (!name) return null;
  return NAME_LOOKUP.get(name.toLowerCase()) ?? null;
}

/**
 * Resolve AFL clubs from Odds API / Squiggle labels.
 * Prefers the longest alias match so "North Melbourne" wins over "Melbourne".
 */
export function resolveTeamIdLoose(name: string | null | undefined): TeamId | null {
  if (!name) return null;
  const direct = resolveTeamId(name);
  if (direct) return direct;

  const lower = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!lower) return null;

  let best: { id: TeamId; len: number } | null = null;
  for (const team of Object.values(TEAMS)) {
    for (const alias of [team.name, ...team.aliases]) {
      const a = alias.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!a) continue;
      if (lower === a) return team.id;
      // Substring only for meaningful aliases (avoid "north" alone)
      if (a.length < 5) continue;
      if (lower.includes(a) || a.includes(lower)) {
        if (!best || a.length > best.len) best = { id: team.id, len: a.length };
      }
    }
  }
  return best?.id ?? null;
}

export function teamDisplayName(id: TeamId): string {
  return TEAMS[id].name;
}

export function teamColors(id: TeamId): { primary: string; secondary: string } {
  return TEAMS[id].colors;
}

export function teamShort(id: TeamId): string {
  return TEAMS[id].short;
}

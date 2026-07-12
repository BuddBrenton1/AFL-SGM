export type BookmakerId =
  | "sportsbet"
  | "tab"
  | "neds"
  | "ladbrokes_au"
  | "pointsbetau"
  | "unibet";

export interface BookmakerOption {
  id: BookmakerId;
  /** Odds API bookmaker key */
  apiKey: BookmakerId;
  label: string;
  shortLabel: string;
}

export const BOOKMAKERS: BookmakerOption[] = [
  { id: "sportsbet", apiKey: "sportsbet", label: "Sportsbet", shortLabel: "SB" },
  { id: "tab", apiKey: "tab", label: "TAB", shortLabel: "TAB" },
  { id: "neds", apiKey: "neds", label: "Neds", shortLabel: "Neds" },
  {
    id: "ladbrokes_au",
    apiKey: "ladbrokes_au",
    label: "Ladbrokes",
    shortLabel: "Lad",
  },
  {
    id: "pointsbetau",
    apiKey: "pointsbetau",
    label: "PointsBet",
    shortLabel: "PB",
  },
  { id: "unibet", apiKey: "unibet", label: "Unibet", shortLabel: "Uni" },
];

export const DEFAULT_BOOKMAKER: BookmakerId = "sportsbet";

export function getBookmaker(id: string | null | undefined): BookmakerOption {
  return (
    BOOKMAKERS.find((b) => b.id === id || b.apiKey === id) ?? BOOKMAKERS[0]
  );
}

export function isBookmakerId(id: string): id is BookmakerId {
  return BOOKMAKERS.some((b) => b.id === id);
}

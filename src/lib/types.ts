export type TeamId =
  | "adelaide"
  | "brisbane"
  | "carlton"
  | "collingwood"
  | "essendon"
  | "fremantle"
  | "geelong"
  | "goldcoast"
  | "gws"
  | "hawthorn"
  | "melbourne"
  | "northmelbourne"
  | "portadelaide"
  | "richmond"
  | "stkilda"
  | "sydney"
  | "westcoast"
  | "westernbulldogs";

export type PlayerRole =
  | "key-forward"
  | "medium-forward"
  | "midfielder"
  | "wing"
  | "ruck"
  | "defender"
  | "tagger";

export type MarketType =
  | "player_goal"
  | "player_disposal"
  | "player_mark"
  | "player_tackle"
  | "team_total_points"
  | "match_result"
  | "line"
  | "total_points";

export interface PlayerSeasonForm {
  games: number;
  goalsAvg: number;
  disposalsAvg: number;
  marksAvg: number;
  tacklesAvg: number;
  hitoutsAvg: number;
  homeGoalsAvg: number;
  awayGoalsAvg: number;
  homeDisposalsAvg: number;
  awayDisposalsAvg: number;
  last5Goals: number[];
  last5Disposals: number[];
  last5Marks: number[];
  last5Tackles: number[];
  goalHitRates: Record<string, number>;
  disposalHitRates: Record<string, number>;
}

export interface PlayerProfile {
  id: string;
  name: string;
  team: TeamId;
  role: PlayerRole;
  jumper: number;
  form: PlayerSeasonForm;
  /** 0–1 reliability of minutes/role */
  roleStability: number;
}

export interface TeamInsOuts {
  team: TeamId;
  ins: string[];
  outs: string[];
  notes: string[];
}

export interface WeatherSnapshot {
  venue: string;
  condition: "clear" | "cloudy" | "light-rain" | "heavy-rain" | "windy";
  tempC: number;
  windKmh: number;
  rainChance: number;
  summary: string;
  /** multipliers applied to markets */
  goalMultiplier: number;
  disposalMultiplier: number;
  tackleMultiplier: number;
}

export interface LadderEntry {
  team: TeamId;
  name: string;
  rank: number;
  points: number;
  percentage: number;
  wins: number;
  losses: number;
  draws: number;
  played: number;
}

export interface FixtureGame {
  id: number;
  round: number;
  roundName: string;
  date: string;
  unixtime: number;
  venue: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
  complete: number;
  homeScore?: number;
  awayScore?: number;
  tipHomeWinProb?: number;
  tipMargin?: number;
}

export interface EnrichedGame extends FixtureGame {
  homeLadder: LadderEntry;
  awayLadder: LadderEntry;
  weather: WeatherSnapshot;
  homeInsOuts: TeamInsOuts;
  awayInsOuts: TeamInsOuts;
  homePlayers: PlayerProfile[];
  awayPlayers: PlayerProfile[];
  homeAdvantage: number;
  expectedTotal: number;
  blowoutRisk: number;
  prediction: {
    homeWinPct: number;
    awayWinPct: number;
    predictedMargin: number;
    favourite: "home" | "away" | "toss-up";
    summary: string;
    factors: FactorSignal[];
  };
}

export interface CandidateLeg {
  id: string;
  gameId: number;
  market: MarketType;
  label: string;
  shortLabel: string;
  playerId?: string;
  playerName?: string;
  teamId?: TeamId;
  threshold?: number;
  /** estimated true probability 0–1 */
  probability: number;
  /** decimal odds used for combo (Sportsbet when available) */
  odds: number;
  /** Bounce model odds before Sportsbet overlay */
  modelOdds?: number;
  /** Live Sportsbet decimal price when matched */
  sportsbetOdds?: number;
  sportsbetMarket?: string;
  sportsbetLink?: string;
  /** Exact Sportsbet line point matched (e.g. 3.5 for 4+ marks) */
  sportsbetPoint?: number;
  /** Human-readable Sportsbet selection, e.g. "Over 3.5" */
  sportsbetSelection?: string;
  confidence: number;
  valueScore: number;
  factors: FactorSignal[];
  correlationGroup: string;
}

export interface FactorSignal {
  key: string;
  label: string;
  impact: "positive" | "negative" | "neutral";
  detail: string;
  weight: number;
}

export interface SgmMulti {
  id: string;
  gameId: number;
  matchup: string;
  venue: string;
  round: number;
  legs: CandidateLeg[];
  combinedOdds: number;
  /** Product of Sportsbet leg prices when every leg matched */
  sportsbetCombinedOdds?: number | null;
  sportsbetCoverage: number;
  sportsbetLink?: string;
  combinedProbability: number;
  confidence: number;
  edgeScore: number;
  rationale: string[];
}

export type ScanMode = "legs" | "odds";

export interface ScanRequest {
  mode: ScanMode;
  legCount?: number;
  targetOdds?: number;
  /** Max decimal price per leg in target-odds mode (default 1.35) */
  maxSingleLegPrice?: number;
  gameIds?: number[];
  maxResults?: number;
  minConfidence?: number;
  /** Only keep legs/multis that have live book prices */
  sportsbetOnly?: boolean;
  /** Selected odds platform (Sportsbet, TAB, Neds, …) */
  bookmaker?: string;
}

export interface ScanResult {
  generatedAt: string;
  mode: ScanMode;
  target: {
    legCount?: number;
    targetOdds?: number;
    maxSingleLegPrice?: number;
    minConfidence?: number;
    sportsbetOnly?: boolean;
    bookmaker?: string;
    bookmakerLabel?: string;
    bookmakerShort?: string;
  };
  gamesScanned: number;
  candidatesEvaluated: number;
  combinationsChecked: number;
  multis: SgmMulti[];
  scanNotes: string[];
  sportsbet?: {
    configured: boolean;
    connected: boolean;
    message: string;
    bookmakerId?: string;
    bookmakerLabel?: string;
    bookmakerShort?: string;
    remainingRequests?: number | null;
    lastError?: string;
  };
}

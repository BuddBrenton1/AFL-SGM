import type { FixtureGame, LadderEntry } from "./types";
import { resolveTeamId } from "./teams";

const UA = "BounceSGM/1.0 (https://github.com/bounce-sgm; AFL SGM scanner)";
const BASE = "https://api.squiggle.com.au";

async function squiggle<T>(query: string): Promise<T> {
  const res = await fetch(`${BASE}/?q=${query}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`Squiggle API ${res.status} for q=${query}`);
  }
  return res.json() as Promise<T>;
}

interface SquiggleGame {
  id: number;
  round: number;
  roundname: string;
  year: number;
  date: string;
  unixtime: number;
  venue: string;
  hteam: string | null;
  ateam: string | null;
  complete: number;
  hscore?: number;
  ascore?: number;
  winner?: string;
}

interface SquiggleStanding {
  id: number;
  name: string;
  rank: number;
  pts: number;
  percentage: number;
  wins: number;
  losses: number;
  draws: number;
  played: number;
}

interface SquiggleTip {
  gameid: number;
  sourceid: number;
  source: string;
  hteam: string;
  ateam: string;
  tip: string;
  confidence: number | string;
  margin: number | string;
  hconfidence?: number | string;
}

function mapGame(g: SquiggleGame, tip?: SquiggleTip): FixtureGame | null {
  if (!g.hteam || !g.ateam || !g.venue) return null;
  const homeTeamId = resolveTeamId(g.hteam);
  const awayTeamId = resolveTeamId(g.ateam);
  if (!homeTeamId || !awayTeamId) return null;

  let tipHomeWinProb: number | undefined;
  if (tip?.confidence != null) {
    const conf = Number(tip.confidence) / 100;
    tipHomeWinProb = tip.tip === g.hteam ? conf : 1 - conf;
  }

  return {
    id: g.id,
    round: g.round,
    roundName: g.roundname,
    date: g.date,
    unixtime: g.unixtime,
    venue: g.venue,
    homeTeam: g.hteam,
    awayTeam: g.ateam,
    homeTeamId,
    awayTeamId,
    complete: g.complete,
    homeScore: g.hscore,
    awayScore: g.ascore,
    winner: g.winner,
    tipHomeWinProb,
    tipMargin: tip?.margin != null ? Number(tip.margin) : undefined,
  };
}

export async function fetchStandings(year = 2026): Promise<LadderEntry[]> {
  const data = await squiggle<{ standings: SquiggleStanding[] }>(
    `standings;year=${year}`,
  );
  return data.standings
    .map((s) => {
      const team = resolveTeamId(s.name);
      if (!team) return null;
      return {
        team,
        name: s.name,
        rank: s.rank,
        points: s.pts,
        percentage: s.percentage,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        played: s.played,
      } satisfies LadderEntry;
    })
    .filter((x): x is LadderEntry => x !== null)
    .sort((a, b) => a.rank - b.rank);
}

export async function fetchUpcomingGames(year = 2026): Promise<FixtureGame[]> {
  const [gamesData, tipsData] = await Promise.all([
    squiggle<{ games: SquiggleGame[] }>(`games;year=${year}`),
    squiggle<{ tips: SquiggleTip[] }>(`tips;year=${year};source=1`).catch(
      () => ({ tips: [] as SquiggleTip[] }),
    ),
  ]);

  const tipByGame = new Map<number, SquiggleTip>();
  for (const tip of tipsData.tips) {
    // Prefer Squiggle's own model; keep first seen per game
    if (!tipByGame.has(tip.gameid)) tipByGame.set(tip.gameid, tip);
  }

  const now = Math.floor(Date.now() / 1000) - 3 * 3600;
  return gamesData.games
    .filter((g) => g.complete < 100 || g.unixtime >= now)
    .map((g) => mapGame(g, tipByGame.get(g.id)))
    .filter((g): g is FixtureGame => g !== null)
    .filter((g) => g.complete < 100)
    .sort((a, b) => a.unixtime - b.unixtime);
}

export async function fetchGameById(
  gameId: number,
): Promise<FixtureGame | null> {
  const data = await squiggle<{ games: SquiggleGame[] }>(
    `games;game=${gameId}`,
  );
  const g = data.games?.[0];
  if (!g) return null;
  return mapGame(g);
}

export async function fetchCompletedGames(year = 2026): Promise<FixtureGame[]> {
  const data = await squiggle<{ games: SquiggleGame[] }>(
    `games;year=${year};complete=100`,
  );
  return data.games
    .map((g) => mapGame(g))
    .filter((g): g is FixtureGame => g !== null)
    .sort((a, b) => b.unixtime - a.unixtime);
}

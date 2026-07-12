/**
 * Live AFL player box scores via ESPN's public site API.
 * Used to auto-settle Bounce SGM player props (goals, disposals, tackles, marks).
 */

export interface EspnPlayerLine {
  name: string;
  team: string;
  disposals: number;
  goals: number;
  tackles: number;
  marks: number;
  kicks: number;
  handballs: number;
  hitouts: number;
  active: boolean;
  starter: boolean;
  /** Proxy for took the field — any meaningful counting stat. */
  involvement: number;
  /** True when the player looks unused (emergency / DNP). */
  didNotPlay: boolean;
}

export interface EspnMatchBox {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  completed: boolean;
  inProgress: boolean;
  statusText: string;
  players: EspnPlayerLine[];
}

function normTeam(s: string): string {
  return s
    .toLowerCase()
    .replace(/giants|cats|eagles|suns|crows|swans|bombers|magpies|blues|demons|tigers|saints|hawks|dockers|kangaroos|power|bulldogs|lions/g, "")
    .replace(/greater western sydney|gws/g, "gws")
    .replace(/gold coast/g, "goldcoast")
    .replace(/west coast/g, "westcoast")
    .replace(/north melbourne|kangaroos/g, "northmelbourne")
    .replace(/port adelaide/g, "portadelaide")
    .replace(/st kilda/g, "stkilda")
    .replace(/western bulldogs|footscray/g, "westernbulldogs")
    .replace(/brisbane lions|brisbane/g, "brisbane")
    .replace(/sydney swans|sydney/g, "sydney")
    .replace(/[^a-z0-9]/g, "");
}

export function teamsLooselyMatch(a: string, b: string): boolean {
  const na = normTeam(a);
  const nb = normTeam(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function playerNamesMatch(a: string, b: string): boolean {
  const na = a
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const nb = b
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ap = na.split(" ").filter(Boolean);
  const bp = nb.split(" ").filter(Boolean);
  if (ap.length < 2 || bp.length < 2) return false;
  const aLast = ap[ap.length - 1];
  const bLast = bp[bp.length - 1];
  const aFirst = ap[0];
  const bFirst = bp[0];
  if (aFirst === bFirst && aLast === bLast) return true;
  if (aLast === bLast && aFirst[0] === bFirst[0]) return true;
  return false;
}

async function espnJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "BounceSGM/1.0 (AFL SGM tracker)",
      },
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type EspnScoreboard = {
  events?: Array<{
    id: string;
    name: string;
    date?: string;
    status: { type: { name: string; completed?: boolean; description?: string } };
    competitions: Array<{
      competitors: Array<{
        homeAway: string;
        score?: string;
        winner?: boolean;
        team: { displayName: string };
      }>;
    }>;
  }>;
};

type EspnSummary = {
  header?: {
    competitions?: Array<{
      status?: { type?: { completed?: boolean; description?: string; name?: string } };
      competitors?: Array<{
        homeAway: string;
        score?: string;
        winner?: boolean;
        team: { displayName: string };
      }>;
    }>;
  };
  boxscore?: {
    players?: Array<{
      team: { displayName: string };
      statistics: Array<{
        labels: string[];
        athletes: Array<{
          active?: boolean;
          starter?: boolean;
          athlete: { displayName: string };
          stats: string[];
        }>;
      }>;
    }>;
  };
};

function dateStamp(isoOrSquiggle: string): string {
  // "2026-07-12 19:40:00" or ISO
  const m = isoOrSquiggle.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const d = new Date(isoOrSquiggle);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${mo}${da}`;
}

export async function findEspnEventId(
  homeTeam: string,
  awayTeam: string,
  gameDate: string,
): Promise<string | null> {
  const stamp = dateStamp(gameDate);
  const urls = [
    stamp
      ? `https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/scoreboard?dates=${stamp}`
      : null,
    "https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/scoreboard",
  ].filter(Boolean) as string[];

  for (const url of urls) {
    const board = await espnJson<EspnScoreboard>(url);
    for (const ev of board?.events ?? []) {
      const comps = ev.competitions?.[0]?.competitors ?? [];
      const home = comps.find((c) => c.homeAway === "home")?.team.displayName;
      const away = comps.find((c) => c.homeAway === "away")?.team.displayName;
      if (!home || !away) continue;
      if (
        teamsLooselyMatch(home, homeTeam) &&
        teamsLooselyMatch(away, awayTeam)
      ) {
        return ev.id;
      }
      // ESPN sometimes flips naming in the title — accept reverse
      if (
        teamsLooselyMatch(home, awayTeam) &&
        teamsLooselyMatch(away, homeTeam)
      ) {
        return ev.id;
      }
    }
  }
  return null;
}

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchEspnMatchBox(
  eventId: string,
): Promise<EspnMatchBox | null> {
  const summary = await espnJson<EspnSummary>(
    `https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/summary?event=${eventId}`,
  );
  if (!summary) return null;

  const comp = summary.header?.competitions?.[0];
  const status = comp?.status?.type;
  const competitors = comp?.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");

  const players: EspnPlayerLine[] = [];
  for (const side of summary.boxscore?.players ?? []) {
    const team = side.team.displayName;
    const group = side.statistics?.[0];
    if (!group) continue;
    const labels = group.labels ?? [];
    const idx = (code: string) => labels.indexOf(code);
    const iD = idx("D");
    const iG = idx("G");
    const iT = idx("T");
    const iM = idx("M");
    const iK = idx("K");
    const iH = idx("H");
    const iHO = idx("HO");
    for (const row of group.athletes ?? []) {
      const st = row.stats ?? [];
      const disposals = iD >= 0 ? num(st[iD]) : 0;
      const goals = iG >= 0 ? num(st[iG]) : 0;
      const tackles = iT >= 0 ? num(st[iT]) : 0;
      const marks = iM >= 0 ? num(st[iM]) : 0;
      const kicks = iK >= 0 ? num(st[iK]) : 0;
      const handballs = iH >= 0 ? num(st[iH]) : 0;
      const hitouts = iHO >= 0 ? num(st[iHO]) : 0;
      const involvement =
        disposals + goals + tackles + marks + kicks + handballs + hitouts;
      players.push({
        name: row.athlete.displayName,
        team,
        disposals,
        goals,
        tackles,
        marks,
        kicks,
        handballs,
        hitouts,
        active: row.active !== false,
        starter: !!row.starter,
        involvement,
        // Unused emergencies often appear on the sheet with all zeros.
        didNotPlay: involvement === 0,
      });
    }
  }

  const completed = !!status?.completed;
  const statusName = status?.name ?? "";
  const inProgress =
    !completed &&
    (statusName.includes("PROGRESS") ||
      statusName.includes("HALFTIME") ||
      /quarter|half|q[1-4]/i.test(status?.description ?? ""));

  return {
    eventId,
    homeTeam: home?.team.displayName ?? "Home",
    awayTeam: away?.team.displayName ?? "Away",
    homeScore: home?.score != null ? Number(home.score) : undefined,
    awayScore: away?.score != null ? Number(away.score) : undefined,
    completed,
    inProgress,
    statusText: status?.description ?? statusName ?? "Unknown",
    players,
  };
}

export function findPlayerLine(
  players: EspnPlayerLine[],
  playerName: string,
): EspnPlayerLine | undefined {
  return players.find((p) => playerNamesMatch(p.name, playerName));
}

export async function loadBoxForFixture(opts: {
  homeTeam: string;
  awayTeam: string;
  date: string;
  espnEventId?: string | null;
}): Promise<EspnMatchBox | null> {
  const eventId =
    opts.espnEventId ||
    (await findEspnEventId(opts.homeTeam, opts.awayTeam, opts.date));
  if (!eventId) return null;
  return fetchEspnMatchBox(eventId);
}

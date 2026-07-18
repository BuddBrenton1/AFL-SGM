import type { TeamId, TeamInsOuts } from "./types";
import { resolveTeamId } from "./teams";

interface RosterPlayer {
  playerName?: string;
  player?: {
    playerName?: string;
    givenName?: string;
    surname?: string;
    playerJumperNumber?: number;
    jumperNumber?: number;
  };
  playerJumperNumber?: number;
  jumperNumber?: number;
  selectedPosition?: string;
  position?: string;
}

export interface RosterGuernsey {
  name: string;
  jumper: number;
  teamId: TeamId;
}

interface RosterTeam {
  teamName?: string;
  teamNickname?: string;
  ins?: RosterPlayer[] | string[];
  outs?: Array<RosterPlayer | { playerName?: string; reason?: string } | string>;
  positions?: RosterPlayer[];
  players?: RosterPlayer[];
}

function playerLabel(p: unknown): string | null {
  if (!p) return null;
  if (typeof p === "string") return p.trim() || null;
  if (typeof p !== "object") return null;
  const obj = p as Record<string, unknown>;
  if (typeof obj.playerName === "string" && obj.playerName.trim()) {
    return obj.playerName.trim();
  }
  const nested = obj.player as Record<string, unknown> | undefined;
  if (nested && typeof nested.playerName === "string") {
    return nested.playerName.trim();
  }
  const given =
    (typeof nested?.givenName === "string" && nested.givenName) ||
    (typeof obj.givenName === "string" && obj.givenName) ||
    "";
  const surname =
    (typeof nested?.surname === "string" && nested.surname) ||
    (typeof obj.surname === "string" && obj.surname) ||
    "";
  const full = `${given} ${surname}`.trim();
  return full || null;
}

async function getAflToken(): Promise<string | null> {
  try {
    const res = await fetch("https://api.afl.com.au/cfs/afl/WMCTok", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://www.afl.com.au",
        Referer: "https://www.afl.com.au/",
        "User-Agent":
          "BounceSGM/1.0 (https://github.com/bounce-sgm; AFL SGM scanner)",
      },
      body: "{}",
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    return data.token ?? null;
  } catch {
    return null;
  }
}

export interface AflMatchRef {
  providerId: string;
  round: number;
  homeTeam: string;
  awayTeam: string;
  homeTeamId?: TeamId | null;
  awayTeamId?: TeamId | null;
  status?: string;
}

/** Load upcoming AFL.com match provider IDs for the current season. */
export async function fetchAflMatchRefs(
  year = 2026,
): Promise<AflMatchRef[]> {
  // Season id discovered via aflapi (2026 Premiership = 85)
  const seasonId = year === 2026 ? 85 : year === 2025 ? 73 : 85;
  const out: AflMatchRef[] = [];

  for (let page = 0; page < 8; page++) {
    const url = `https://aflapi.afl.com.au/afl/v2/matches?pageSize=50&competitionId=1&compSeasonId=${seasonId}&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "BounceSGM/1.0 (https://github.com/bounce-sgm; AFL SGM scanner)",
      },
      next: { revalidate: 1800 },
    });
    if (!res.ok) break;
    const data = (await res.json()) as {
      matches?: Array<{
        providerId: string;
        status?: string;
        round?: { roundNumber?: number };
        home?: { team?: { name?: string } };
        away?: { team?: { name?: string } };
      }>;
      meta?: { pagination?: { numPages?: number } };
    };
    for (const m of data.matches ?? []) {
      const homeTeam = m.home?.team?.name ?? "";
      const awayTeam = m.away?.team?.name ?? "";
      out.push({
        providerId: m.providerId,
        round: m.round?.roundNumber ?? 0,
        homeTeam,
        awayTeam,
        homeTeamId: resolveTeamId(homeTeam),
        awayTeamId: resolveTeamId(awayTeam),
        status: m.status,
      });
    }
    const pages = data.meta?.pagination?.numPages ?? 1;
    if (page + 1 >= pages) break;
  }

  return out;
}

export interface MatchLineupInsOuts {
  home: TeamInsOuts;
  away: TeamInsOuts;
  available: boolean;
  /** Named players with guernsey numbers from the official sheet */
  guernseys: RosterGuernsey[];
}

function jumperFromRosterPlayer(p: unknown): number | null {
  if (!p || typeof p !== "object") return null;
  const obj = p as RosterPlayer;
  const n =
    obj.playerJumperNumber ??
    obj.jumperNumber ??
    obj.player?.playerJumperNumber ??
    obj.player?.jumperNumber;
  if (n == null || !Number.isFinite(Number(n))) return null;
  const jumper = Number(n);
  return jumper > 0 && jumper < 100 ? jumper : null;
}

function guernseysFromSide(
  teamId: TeamId,
  side: RosterTeam | undefined,
): RosterGuernsey[] {
  if (!side) return [];
  const rows = [
    ...(side.positions ?? []),
    ...(side.players ?? []),
    ...(side.ins ?? []),
  ];
  const out: RosterGuernsey[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = playerLabel(row);
    const jumper = jumperFromRosterPlayer(row);
    if (!name || jumper == null) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, jumper, teamId });
  }
  return out;
}

function teamFromRoster(
  teamId: TeamId,
  side: RosterTeam | undefined,
): TeamInsOuts {
  const ins = (side?.ins ?? [])
    .map((p) => playerLabel(p))
    .filter((x): x is string => !!x);
  const outs = (side?.outs ?? [])
    .map((p) => {
      const name = playerLabel(p);
      if (!name) return null;
      if (typeof p === "object" && p && "reason" in p) {
        const reason = (p as { reason?: string }).reason;
        return reason ? `${name} (${reason})` : name;
      }
      return name;
    })
    .filter((x): x is string => !!x);

  const available = ins.length > 0 || outs.length > 0;
  return {
    team: teamId,
    ins,
    outs,
    notes: available
      ? [
          `Official AFL team sheet · ${ins.length} in / ${outs.length} out`,
          ...outs.slice(0, 2).map((o) => `Out: ${o}`),
        ]
      : ["Official team sheet not published yet"],
  };
}

export async function fetchMatchLineupInsOuts(
  providerId: string,
  homeTeamId: TeamId,
  awayTeamId: TeamId,
): Promise<MatchLineupInsOuts | null> {
  const token = await getAflToken();
  if (!token) return null;

  const res = await fetch(
    `https://api.afl.com.au/cfs/afl/matchRoster/full/${providerId}`,
    {
      headers: {
        Accept: "application/json",
        "x-media-mis-token": token,
        Origin: "https://www.afl.com.au",
        Referer: "https://www.afl.com.au/",
        "User-Agent":
          "BounceSGM/1.0 (https://github.com/bounce-sgm; AFL SGM scanner)",
      },
      next: { revalidate: 900 },
    },
  );

  if (res.status === 404) {
    return {
      home: {
        team: homeTeamId,
        ins: [],
        outs: [],
        notes: ["Official team sheet not published yet"],
      },
      away: {
        team: awayTeamId,
        ins: [],
        outs: [],
        notes: ["Official team sheet not published yet"],
      },
      available: false,
      guernseys: [],
    };
  }
  if (!res.ok) return null;

  const data = (await res.json()) as {
    matchRoster?: { homeTeam?: RosterTeam; awayTeam?: RosterTeam };
  };
  const home = teamFromRoster(homeTeamId, data.matchRoster?.homeTeam);
  const away = teamFromRoster(awayTeamId, data.matchRoster?.awayTeam);
  const guernseys = [
    ...guernseysFromSide(homeTeamId, data.matchRoster?.homeTeam),
    ...guernseysFromSide(awayTeamId, data.matchRoster?.awayTeam),
  ];
  return {
    home,
    away,
    available:
      home.ins.length + home.outs.length + away.ins.length + away.outs.length >
      0 || guernseys.length > 0,
    guernseys,
  };
}

export function findAflMatchRef(
  refs: AflMatchRef[],
  round: number,
  homeTeamId: TeamId,
  awayTeamId: TeamId,
): AflMatchRef | undefined {
  return refs.find(
    (r) =>
      r.round === round &&
      ((r.homeTeamId === homeTeamId && r.awayTeamId === awayTeamId) ||
        (r.homeTeamId === awayTeamId && r.awayTeamId === homeTeamId)),
  );
}

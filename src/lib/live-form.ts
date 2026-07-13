/**
 * Live last-5 player form from ESPN box scores.
 * Replaces inferred seed tackle/mark lines so BEST locks aren't fake.
 */

import type { PlayerProfile, TeamId } from "./types";
import { fetchEspnMatchBox, teamsLooselyMatch } from "./espn-stats";
import { TEAMS } from "./teams";

const ESPN_TEAM_IDS: Partial<Record<TeamId, string>> = {
  adelaide: "15",
  brisbane: "11",
  carlton: "9",
  collingwood: "17",
  essendon: "16",
  fremantle: "1",
  gws: "8",
  geelong: "14",
  goldcoast: "10",
  hawthorn: "13",
  melbourne: "2",
  northmelbourne: "5",
  portadelaide: "7",
  richmond: "12",
  stkilda: "18",
  sydney: "4",
  westcoast: "3",
  westernbulldogs: "6",
};

type EspnSchedule = {
  events?: Array<{
    id: string;
    date?: string;
    competitions?: Array<{
      status?: { type?: { completed?: boolean } };
    }>;
  }>;
};

export interface LiveFormLine {
  name: string;
  teamId: TeamId;
  last5Goals: number[];
  last5Disposals: number[];
  last5Marks: number[];
  last5Tackles: number[];
  games: number;
}

function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
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
        "User-Agent": "BounceSGM/1.0 (AFL live form)",
      },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function hitRate(values: number[], threshold: number): number {
  if (!values.length) return 0;
  return values.filter((v) => v >= threshold).length / values.length;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function completedEventIdsForTeam(
  espnTeamId: string,
  limit = 5,
): Promise<string[]> {
  const board = await espnJson<EspnSchedule>(
    `https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/teams/${espnTeamId}/schedule`,
  );
  const done = (board?.events ?? []).filter(
    (e) => e.competitions?.[0]?.status?.type?.completed,
  );
  return done.slice(-limit).map((e) => e.id);
}

/**
 * Load last-5 ESPN box logs for the given clubs (shared box-score cache).
 */
export async function loadLiveFormForTeams(
  teamIds: TeamId[],
  games = 5,
): Promise<{
  byName: Map<string, LiveFormLine>;
  teamsCovered: number;
  boxesFetched: number;
  message: string;
}> {
  const unique = [...new Set(teamIds)];
  const boxCache = new Map<string, Awaited<ReturnType<typeof fetchEspnMatchBox>>>();
  const logs = new Map<
    string,
    {
      teamId: TeamId;
      name: string;
      goals: number[];
      disposals: number[];
      marks: number[];
      tackles: number[];
    }
  >();

  let boxesFetched = 0;
  let teamsCovered = 0;

  const scheduleResults = await Promise.all(
    unique.map(async (teamId) => {
      const espnId = ESPN_TEAM_IDS[teamId];
      if (!espnId) return { teamId, eventIds: [] as string[] };
      const eventIds = await completedEventIdsForTeam(espnId, games);
      return { teamId, eventIds };
    }),
  );

  const allEventIds = [
    ...new Set(scheduleResults.flatMap((r) => r.eventIds)),
  ];
  await Promise.all(
    allEventIds.map(async (eventId) => {
      const box = await fetchEspnMatchBox(eventId);
      boxCache.set(eventId, box);
      if (box) boxesFetched += 1;
    }),
  );

  for (const { teamId, eventIds } of scheduleResults) {
    if (!eventIds.length) continue;
    teamsCovered += 1;
    const clubName = TEAMS[teamId]?.name ?? teamId;

    for (const eventId of eventIds) {
      const box = boxCache.get(eventId);
      if (!box?.completed) continue;

      for (const row of box.players) {
        if (row.didNotPlay) continue;
        if (!teamsLooselyMatch(row.team, clubName)) continue;
        const key = normalizePersonName(row.name);
        if (!key) continue;
        const existing = logs.get(key) ?? {
          teamId,
          name: row.name,
          goals: [],
          disposals: [],
          marks: [],
          tackles: [],
        };
        existing.teamId = teamId;
        existing.goals.push(row.goals);
        existing.disposals.push(row.disposals);
        existing.marks.push(row.marks);
        existing.tackles.push(row.tackles);
        logs.set(key, existing);
      }
    }
  }

  const byName = new Map<string, LiveFormLine>();
  for (const row of logs.values()) {
    // Keep chronologically oldest→newest; schedule slice is already that order
    const last5Goals = row.goals.slice(-games);
    const last5Disposals = row.disposals.slice(-games);
    const last5Marks = row.marks.slice(-games);
    const last5Tackles = row.tackles.slice(-games);
    if (last5Disposals.length < 5 && last5Tackles.length < 5) continue;
    byName.set(normalizePersonName(row.name), {
      name: row.name,
      teamId: row.teamId,
      last5Goals,
      last5Disposals,
      last5Marks,
      last5Tackles,
      games: Math.max(
        last5Goals.length,
        last5Disposals.length,
        last5Marks.length,
        last5Tackles.length,
      ),
    });
  }

  return {
    byName,
    teamsCovered,
    boxesFetched,
    message:
      teamsCovered > 0
        ? `Live ESPN form: last ${games} games for ${teamsCovered} club${teamsCovered === 1 ? "" : "s"} (${boxesFetched} box scores)`
        : "Live ESPN form unavailable — BEST will ignore inferred tackle/mark lines",
  };
}

export function applyLiveFormToPlayers(
  players: PlayerProfile[],
  liveByName: Map<string, LiveFormLine>,
): { players: PlayerProfile[]; matched: number } {
  let matched = 0;
  const next = players.map((player) => {
    const live =
      liveByName.get(normalizePersonName(player.name)) ??
      [...liveByName.values()].find((l) => namesMatch(l.name, player.name));
    if (!live || live.games < 5) return player;
    matched += 1;
    const last5Goals = live.last5Goals.slice(-5);
    const last5Disposals = live.last5Disposals.slice(-5);
    const last5Marks = live.last5Marks.slice(-5);
    const last5Tackles = live.last5Tackles.slice(-5);
    const disposalHitRates: Record<string, number> = {};
    for (let th = 10; th <= 35; th += 1) {
      disposalHitRates[`${th}+`] = hitRate(last5Disposals, th);
    }
    const goalHitRates: Record<string, number> = {};
    for (let th = 1; th <= 5; th += 1) {
      goalHitRates[`${th}+`] = hitRate(last5Goals, th);
    }
    return {
      ...player,
      marksExplicit: true,
      tacklesExplicit: true,
      formSource: "espn" as const,
      form: {
        ...player.form,
        games: Math.max(player.form.games, live.games),
        goalsAvg: mean(last5Goals) || player.form.goalsAvg,
        disposalsAvg: mean(last5Disposals) || player.form.disposalsAvg,
        marksAvg: mean(last5Marks) || player.form.marksAvg,
        tacklesAvg: mean(last5Tackles) || player.form.tacklesAvg,
        last5Goals,
        last5Disposals,
        last5Marks,
        last5Tackles,
        goalHitRates,
        disposalHitRates,
      },
    };
  });
  return { players: next, matched };
}

/** @internal test helper */
export function __testNamesMatch(a: string, b: string) {
  return namesMatch(a, b);
}

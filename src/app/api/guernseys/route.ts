import { NextResponse } from "next/server";
import {
  fetchAflMatchRefs,
  fetchClubGuernseysFromLatestMatch,
} from "@/lib/afl-lineups";
import { resolveTeamId, resolveTeamIdLoose, TEAMS } from "@/lib/teams";
import type { TeamId } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseTeamParam(raw: string): TeamId | null {
  const key = raw.trim();
  if (!key) return null;
  // Paper trades send canonical ids like "westcoast"
  if (key in TEAMS) return key as TeamId;
  return resolveTeamId(key) ?? resolveTeamIdLoose(key);
}

/** Resolve jumper numbers for clubs (from latest concluded AFL team sheets). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = [
    searchParams.get("home"),
    searchParams.get("away"),
    ...(searchParams.get("teams")?.split(",") ?? []),
  ].filter(Boolean) as string[];

  const teamIds = [
    ...new Set(
      raw.map(parseTeamParam).filter((t): t is TeamId => t != null),
    ),
  ];

  if (!teamIds.length) {
    return NextResponse.json({
      guernseys: [],
      error: `No clubs resolved from: ${raw.join(",")}`,
    });
  }

  try {
    const refs = await fetchAflMatchRefs(2026);
    const rows = (
      await Promise.all(
        teamIds.map((id) => fetchClubGuernseysFromLatestMatch(refs, id)),
      )
    ).flat();

    return NextResponse.json({
      guernseys: rows.map((g) => ({
        name: g.name,
        jumper: g.jumper,
        teamId: g.teamId,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      {
        guernseys: [],
        error: err instanceof Error ? err.message : "Failed to load guernseys",
      },
      { status: 500 },
    );
  }
}

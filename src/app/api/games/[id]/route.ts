import { NextResponse } from "next/server";
import { loadBoxForFixture } from "@/lib/espn-stats";
import { fetchGameById } from "@/lib/squiggle";
import { mergeEspnBox } from "@/lib/settle";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const gameId = Number(id);
    if (!Number.isFinite(gameId)) {
      return NextResponse.json({ error: "Invalid game id" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const espnEventId = searchParams.get("espnEventId");

    const game = await fetchGameById(gameId);
    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }

    const box = await loadBoxForFixture({
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      date: game.date,
      espnEventId,
    });

    const payload = mergeEspnBox(
      {
        id: game.id,
        complete: game.complete,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        winner: game.winner,
        round: game.round,
        venue: game.venue,
        date: game.date,
      },
      box,
    );

    return NextResponse.json({
      ...payload,
      playerCount: payload.players?.length ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load game";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { fetchGameById } from "@/lib/squiggle";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const gameId = Number(id);
    if (!Number.isFinite(gameId)) {
      return NextResponse.json({ error: "Invalid game id" }, { status: 400 });
    }
    const game = await fetchGameById(gameId);
    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }
    return NextResponse.json({
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
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load game";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

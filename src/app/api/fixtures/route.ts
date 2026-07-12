import { NextResponse } from "next/server";
import { loadEnrichedFixtures } from "@/lib/scan";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const games = await loadEnrichedFixtures();
    return NextResponse.json({
      games: games.map((g) => ({
        id: g.id,
        round: g.round,
        roundName: g.roundName,
        date: g.date,
        venue: g.venue,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        tipHomeWinProb: g.tipHomeWinProb,
        tipMargin: g.tipMargin,
        homeRank: g.homeLadder.rank,
        awayRank: g.awayLadder.rank,
        weather: g.weather,
        homeInsOuts: g.homeInsOuts,
        awayInsOuts: g.awayInsOuts,
        expectedTotal: Math.round(g.expectedTotal),
        blowoutRisk: g.blowoutRisk,
        prediction: {
          homeWinPct: g.prediction.homeWinPct,
          awayWinPct: g.prediction.awayWinPct,
          predictedMargin: g.prediction.predictedMargin,
          favourite: g.prediction.favourite,
          summary: g.prediction.summary,
          factors: g.prediction.factors,
        },
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load fixtures";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

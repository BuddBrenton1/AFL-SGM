import { NextResponse } from "next/server";
import { isBookmakerId } from "@/lib/bookmakers";
import { runDeepScan } from "@/lib/scan";
import type { ScanRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ScanRequest>;
    // Unified builder: always target-price with max-legs / max-price / confidence
    const mode = "odds";

    if (body.bookmaker != null && !isBookmakerId(String(body.bookmaker))) {
      return NextResponse.json(
        {
          error:
            "Invalid platform. Choose Sportsbet, TAB, Neds, Ladbrokes, PointsBet, or Unibet.",
        },
        { status: 400 },
      );
    }

    const targetOdds = Number(body.targetOdds ?? 15);
    if (!Number.isFinite(targetOdds) || targetOdds < 2 || targetOdds > 500) {
      return NextResponse.json(
        { error: "Target odds must be between $2 and $500" },
        { status: 400 },
      );
    }

    const maxLegs = Number(body.legCount ?? 10);
    if (!Number.isFinite(maxLegs) || maxLegs < 2 || maxLegs > 25) {
      return NextResponse.json(
        { error: "Max legs must be between 2 and 25" },
        { status: 400 },
      );
    }

    let maxSingleLegPrice = 1.65;
    if (body.maxSingleLegPrice != null) {
      const cap = Number(body.maxSingleLegPrice);
      if (!Number.isFinite(cap) || cap < 1.05 || cap > 3) {
        return NextResponse.json(
          { error: "Max single leg price must be between $1.05 and $3.00" },
          { status: 400 },
        );
      }
      maxSingleLegPrice = cap;
    }

    if (body.minConfidence != null) {
      const minConfidence = Number(body.minConfidence);
      if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 0.95) {
        return NextResponse.json(
          { error: "Minimum confidence must be between 0 and 0.95" },
          { status: 400 },
        );
      }
    }

    const result = await runDeepScan({
      mode,
      legCount: maxLegs,
      targetOdds,
      maxSingleLegPrice,
      gameIds: body.gameIds,
      maxResults: body.maxResults ? Number(body.maxResults) : 12,
      minConfidence:
        body.minConfidence != null ? Number(body.minConfidence) : 0,
      sportsbetOnly: body.sportsbetOnly === true,
      bookmaker: body.bookmaker ? String(body.bookmaker) : undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

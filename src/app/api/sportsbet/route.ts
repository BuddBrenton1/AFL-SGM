import { NextResponse } from "next/server";
import { DEFAULT_BOOKMAKER, isBookmakerId } from "@/lib/bookmakers";
import { sportsbetStatusOnly } from "@/lib/scan";
import { loadSportsbetBoard } from "@/lib/sportsbet";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const probe = searchParams.get("probe") === "1";
  const raw = searchParams.get("bookmaker");
  const bookmaker =
    raw && isBookmakerId(raw) ? raw : DEFAULT_BOOKMAKER;
  const base = sportsbetStatusOnly(bookmaker);

  if (!probe || !base.configured) {
    return NextResponse.json(base);
  }

  try {
    const { status } = await loadSportsbetBoard([], bookmaker);
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json({
      ...base,
      connected: false,
      lastError: err instanceof Error ? err.message : "Probe failed",
    });
  }
}

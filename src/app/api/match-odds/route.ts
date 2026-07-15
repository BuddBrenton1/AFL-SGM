import { NextResponse } from "next/server";
import { DEFAULT_BOOKMAKER, isBookmakerId } from "@/lib/bookmakers";
import { loadBookmakerH2hPrices } from "@/lib/sportsbet";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("bookmaker");
  const bookmaker =
    raw && isBookmakerId(raw) ? raw : DEFAULT_BOOKMAKER;

  try {
    const { prices, status } = await loadBookmakerH2hPrices(bookmaker);
    return NextResponse.json({ prices, status });
  } catch (err) {
    return NextResponse.json(
      {
        prices: [],
        status: {
          configured: false,
          connected: false,
          message: err instanceof Error ? err.message : "Failed to load match odds",
        },
      },
      { status: 500 },
    );
  }
}

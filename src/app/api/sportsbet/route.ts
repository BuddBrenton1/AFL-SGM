import { NextResponse } from "next/server";
import { DEFAULT_BOOKMAKER, isBookmakerId } from "@/lib/bookmakers";
import { sportsbetStatusOnly } from "@/lib/scan";
import { probeSportsbetStatus } from "@/lib/sportsbet";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const probe = searchParams.get("probe") === "1";
  const raw = searchParams.get("bookmaker");
  const bookmaker =
    raw && isBookmakerId(raw) ? raw : DEFAULT_BOOKMAKER;
  const base = sportsbetStatusOnly(bookmaker);

  // Default: free probe so the UI shows quota / connection before a scan burns credits
  if (!probe) {
    if (!base.configured) return NextResponse.json(base);
    try {
      return NextResponse.json(await probeSportsbetStatus(bookmaker));
    } catch (err) {
      return NextResponse.json({
        ...base,
        connected: false,
        lastError: err instanceof Error ? err.message : "Probe failed",
      });
    }
  }

  // probe=1 is the same free check (kept for backwards compatibility)
  try {
    return NextResponse.json(await probeSportsbetStatus(bookmaker));
  } catch (err) {
    return NextResponse.json({
      ...base,
      connected: false,
      lastError: err instanceof Error ? err.message : "Probe failed",
    });
  }
}

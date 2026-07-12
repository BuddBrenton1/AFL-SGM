import { NextResponse } from "next/server";
import { runDeepScan } from "@/lib/scan";
import type { ScanRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ScanRequest>;
    const mode = body.mode === "odds" ? "odds" : "legs";

    if (mode === "legs") {
      const legCount = Number(body.legCount ?? 3);
      if (!Number.isFinite(legCount) || legCount < 2 || legCount > 6) {
        return NextResponse.json(
          { error: "Leg count must be between 2 and 6" },
          { status: 400 },
        );
      }
    } else {
      const targetOdds = Number(body.targetOdds ?? 10);
      if (!Number.isFinite(targetOdds) || targetOdds < 2 || targetOdds > 500) {
        return NextResponse.json(
          { error: "Target odds must be between $2 and $500" },
          { status: 400 },
        );
      }
    }

    const result = await runDeepScan({
      mode,
      legCount: body.legCount ? Number(body.legCount) : 3,
      targetOdds: body.targetOdds ? Number(body.targetOdds) : 10,
      gameIds: body.gameIds,
      maxResults: body.maxResults ? Number(body.maxResults) : 12,
      minConfidence: body.minConfidence ? Number(body.minConfidence) : 0,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

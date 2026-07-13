import type { CandidateLeg, SgmMulti } from "./types";
import { formatOdds } from "./engine/odds";

function legBookPrice(leg: CandidateLeg): number {
  return leg.sportsbetOdds ?? leg.odds;
}

/** Plain-text SGM checklist for recreating on a bookmaker. */
export function formatSgmForBookmaker(
  multi: SgmMulti,
  bookLabel = "Sportsbet",
): string {
  const lines = [
    `${multi.matchup} · Round ${multi.round} · ${multi.venue}`,
    `Target SGM ~${formatOdds(multi.combinedOdds)} · ${multi.legs.length} legs`,
    `Rebuild as Same Game Multi on ${bookLabel}:`,
    "",
    ...multi.legs.map((leg, i) => {
      const sel = leg.sportsbetSelection ? ` (${leg.sportsbetSelection})` : "";
      return `${i + 1}. ${leg.label}${sel} · ${formatOdds(legBookPrice(leg))}`;
    }),
    "",
    `Note: ${bookLabel} prices the SGM with correlation — the slip total may differ from the product above.`,
  ];
  return lines.join("\n");
}

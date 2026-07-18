"use client";

import { TEAMS } from "@/lib/teams";
import type { TeamId } from "@/lib/types";

/** Pick readable ink on a club primary (use secondary when it's light enough). */
export function inkOnTeamColor(primary: string, secondary: string): string {
  const lum = (hex: string) => {
    const h = hex.replace("#", "");
    if (h.length < 6) return 0;
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const p = lum(primary);
  const s = lum(secondary);
  if (p < 0.45) {
    // Dark strip — prefer white, or a light secondary
    return s > 0.55 ? secondary : "#FFFFFF";
  }
  // Light strip — dark ink
  return s < 0.35 ? secondary : "#111111";
}

/** Jumper on club colour + player name — easy to check against a live scoresheet. */
export function PlayerLegLabel(props: {
  label: string;
  playerName?: string;
  teamId?: TeamId;
  jumper?: number;
}) {
  const { label, playerName, teamId, jumper } = props;
  const team = teamId ? TEAMS[teamId] : null;

  if (!playerName || !team) {
    return <>{label}</>;
  }

  const rest = label.startsWith(playerName)
    ? label.slice(playerName.length).trimStart()
    : "";
  const fg = inkOnTeamColor(team.colors.primary, team.colors.secondary);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span
        className="inline-flex h-6 min-w-[1.65rem] shrink-0 items-center justify-center px-1.5 text-[11px] font-bold tabular-nums leading-none"
        style={{ backgroundColor: team.colors.primary, color: fg }}
        title={`${team.name}${jumper != null ? ` · #${jumper}` : ""}`}
      >
        {jumper != null ? jumper : team.short}
      </span>
      <span>
        <span className="font-semibold">{playerName}</span>
        {rest ? <span className="font-medium"> {rest}</span> : null}
      </span>
    </span>
  );
}

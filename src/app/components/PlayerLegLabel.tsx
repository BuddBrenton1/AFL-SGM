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
    return s > 0.55 ? secondary : "#FFFFFF";
  }
  return s < 0.35 ? secondary : "#111111";
}

function GuernseyIcon(props: {
  primary: string;
  secondary: string;
  fg: string;
  label: string;
  title: string;
}) {
  const { primary, secondary, fg, label, title } = props;
  return (
    <span
      className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center"
      title={title}
      aria-label={title}
    >
      <svg
        viewBox="0 0 40 44"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        {/* Little AFL guernsey silhouette */}
        <path
          d="M8 9.5 L14.5 7.5 L16.5 14.5 L20 12.5 L23.5 14.5 L25.5 7.5 L32 9.5 L30.5 17.5 L30.5 38.5 C30.5 40 29 41 27.5 41 L12.5 41 C11 41 9.5 40 9.5 38.5 L9.5 17.5 Z"
          fill={primary}
          stroke={secondary}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        {/* Collar V */}
        <path
          d="M16.5 14.5 L20 18.5 L23.5 14.5"
          fill="none"
          stroke={secondary}
          strokeWidth="1.2"
          strokeLinejoin="round"
          opacity="0.85"
        />
      </svg>
      <span
        className="relative z-[1] font-[family-name:var(--font-teko)] text-[13px] leading-none tabular-nums"
        style={{ color: fg, fontWeight: 700 }}
      >
        {label}
      </span>
    </span>
  );
}

/** Guernsey icon (club colours + jumper #) beside the player name. */
export function PlayerLegLabel(props: {
  label: string;
  playerName?: string;
  teamId?: TeamId;
  jumper?: number;
}) {
  const { label, playerName, teamId, jumper } = props;
  const team = teamId ? TEAMS[teamId] : null;

  // Need a club at minimum — jumper alone without team colour is rare
  if (!playerName || !team) {
    return <>{label}</>;
  }

  const rest = label.startsWith(playerName)
    ? label.slice(playerName.length).trimStart()
    : "";
  const fg = inkOnTeamColor(team.colors.primary, team.colors.secondary);
  const badge = jumper != null ? String(jumper) : team.short.slice(0, 3);
  const title = `${team.name}${jumper != null ? ` · #${jumper}` : ""}`;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <GuernseyIcon
        primary={team.colors.primary}
        secondary={team.colors.secondary}
        fg={fg}
        label={badge}
        title={title}
      />
      <span>
        <span className="font-semibold">{playerName}</span>
        {rest ? <span className="font-medium"> {rest}</span> : null}
      </span>
    </span>
  );
}

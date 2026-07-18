import type { LiveFormLine } from "./live-form";
import { PLAYER_POOL } from "./players";
import type { CandidateLeg, EnrichedGame, RosterGuernseyRef, TeamId } from "./types";

function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ap = na.split(" ").filter(Boolean);
  const bp = nb.split(" ").filter(Boolean);
  if (ap.length < 2 || bp.length < 2) return false;
  const aLast = ap[ap.length - 1];
  const bLast = bp[bp.length - 1];
  if (aLast !== bLast) return false;
  const aFirst = ap[0];
  const bFirst = bp[0];
  if (aFirst === bFirst) return true;
  if (aFirst.length === 1 || bFirst.length === 1) return aFirst[0] === bFirst[0];
  return false;
}

function lookupGuernsey(
  name: string,
  guernseys: RosterGuernseyRef[] | undefined,
): RosterGuernseyRef | undefined {
  if (!guernseys?.length) return undefined;
  return (
    guernseys.find((g) => normalizePersonName(g.name) === normalizePersonName(name)) ??
    guernseys.find((g) => namesMatch(g.name, name))
  );
}

function lookupSeedPlayer(name: string, teamHint?: TeamId) {
  const pool = teamHint
    ? PLAYER_POOL.filter((p) => p.team === teamHint)
    : PLAYER_POOL;
  return (
    pool.find((p) => normalizePersonName(p.name) === normalizePersonName(name)) ??
    pool.find((p) => namesMatch(p.name, name)) ??
    (teamHint
      ? PLAYER_POOL.find((p) => namesMatch(p.name, name))
      : undefined)
  );
}

function lookupLive(
  name: string,
  liveByName: Map<string, LiveFormLine> | undefined,
): LiveFormLine | undefined {
  if (!liveByName?.size) return undefined;
  const direct = liveByName.get(normalizePersonName(name));
  if (direct) return direct;
  return [...liveByName.values()].find((l) => namesMatch(l.name, name));
}

/**
 * Stamp every player prop with team colour + guernsey number when we can
 * resolve them from the AFL team sheet, ESPN live form, or seed roster.
 */
export function enrichLegsWithGuernsey(
  legs: CandidateLeg[],
  game: EnrichedGame,
  liveByName?: Map<string, LiveFormLine>,
): CandidateLeg[] {
  const guernseys = game.rosterGuernseys ?? [];

  return legs.map((leg) => {
    if (!leg.playerName && !leg.playerId) return leg;

    const name = leg.playerName ?? "";
    const sheet = name ? lookupGuernsey(name, guernseys) : undefined;
    const live = name ? lookupLive(name, liveByName) : undefined;
    const seed = name
      ? lookupSeedPlayer(name, sheet?.teamId ?? live?.teamId ?? leg.teamId)
      : undefined;

    const rosterPlayer =
      (leg.playerId
        ? game.homePlayers.find((p) => p.id === leg.playerId) ??
          game.awayPlayers.find((p) => p.id === leg.playerId)
        : undefined) ??
      (name
        ? game.homePlayers.find((p) => namesMatch(p.name, name)) ??
          game.awayPlayers.find((p) => namesMatch(p.name, name))
        : undefined);

    const teamId =
      leg.teamId ??
      sheet?.teamId ??
      live?.teamId ??
      rosterPlayer?.team ??
      seed?.team;
    const jumper =
      leg.jumper ??
      sheet?.jumper ??
      rosterPlayer?.jumper ??
      seed?.jumper;

    if (teamId === leg.teamId && jumper === leg.jumper) return leg;

    return {
      ...leg,
      teamId,
      jumper,
      playerId: leg.playerId ?? rosterPlayer?.id ?? seed?.id,
      playerName: leg.playerName ?? rosterPlayer?.name ?? seed?.name ?? live?.name,
    };
  });
}

import { getInsOuts } from "./ins-outs";
import { playersForTeam } from "./players";
import { fetchStandings, fetchUpcomingGames } from "./squiggle";
import {
  applySportsbetPrices,
  getSportsbetConfigStatus,
  legsFromSportsbetBoard,
  loadSportsbetBoard,
  lookupSportsbetBoard,
} from "./sportsbet";
import { getBookmaker } from "./bookmakers";
import { TEAMS } from "./teams";
import type {
  EnrichedGame,
  FixtureGame,
  LadderEntry,
  ScanRequest,
  ScanResult,
} from "./types";
import { generateLegsForGame } from "./engine/legs";
import { predictMatch } from "./engine/predict";
import { deepScanGame } from "./engine/scanner";
import { getWeatherForFixture } from "./weather";

function fallbackLadder(teamId: FixtureGame["homeTeamId"], rank: number): LadderEntry {
  return {
    team: teamId,
    name: TEAMS[teamId].name,
    rank,
    points: Math.max(0, 68 - rank * 4),
    percentage: 100,
    wins: 0,
    losses: 0,
    draws: 0,
    played: 0,
  };
}

export function enrichGame(
  game: FixtureGame,
  ladderByTeam: Map<string, LadderEntry>,
): EnrichedGame {
  const homeLadder =
    ladderByTeam.get(game.homeTeamId) ?? fallbackLadder(game.homeTeamId, 9);
  const awayLadder =
    ladderByTeam.get(game.awayTeamId) ?? fallbackLadder(game.awayTeamId, 10);

  const tip = game.tipHomeWinProb ?? 0.5;
  const rankGap = awayLadder.rank - homeLadder.rank;
  const homeAdvantage = 0.04 + (game.venue === TEAMS[game.homeTeamId].primaryVenue ? 0.03 : 0.01);
  const blowoutRisk = Math.min(0.9, Math.abs(tip - 0.5) * 2 + Math.abs(rankGap) * 0.02);
  const expectedTotal =
    168 +
    (homeLadder.percentage + awayLadder.percentage - 200) * 0.15 +
    (blowoutRisk > 0.55 ? 6 : 0);

  const enriched: EnrichedGame = {
    ...game,
    homeLadder,
    awayLadder,
    weather: getWeatherForFixture(game.venue, game.date, game.id),
    homeInsOuts: getInsOuts(game.homeTeamId),
    awayInsOuts: getInsOuts(game.awayTeamId),
    homePlayers: playersForTeam(game.homeTeamId),
    awayPlayers: playersForTeam(game.awayTeamId),
    homeAdvantage,
    expectedTotal,
    blowoutRisk,
    prediction: {
      homeWinPct: 0.5,
      awayWinPct: 0.5,
      predictedMargin: 0,
      favourite: "toss-up",
      summary: "",
      factors: [],
    },
  };
  enriched.prediction = predictMatch(enriched);
  return enriched;
}

export async function loadEnrichedFixtures(): Promise<EnrichedGame[]> {
  const [games, standings] = await Promise.all([
    fetchUpcomingGames(2026),
    fetchStandings(2026),
  ]);
  const ladderByTeam = new Map(standings.map((s) => [s.team, s]));
  return games.map((g) => enrichGame(g, ladderByTeam));
}

export async function runDeepScan(req: ScanRequest): Promise<ScanResult> {
  const games = await loadEnrichedFixtures();
  const selected = req.gameIds?.length
    ? games.filter((g) => req.gameIds!.includes(g.id))
    : games.slice(0, 10);

  const book = getBookmaker(req.bookmaker);
  const bookmaker = book.id;

  const { byMatchup, status: sportsbetStatus } = await loadSportsbetBoard(
    selected.map((g) => ({ homeTeam: g.homeTeam, awayTeam: g.awayTeam })),
    bookmaker,
  );

  const mode = req.mode;
  const maxResults = req.maxResults ?? 12;
  const allMultis = [];
  let candidatesEvaluated = 0;
  let combinationsChecked = 0;
  let gamesSkippedNoBoard = 0;
  let gamesSkippedSparsePrices = 0;
  const scanNotes: string[] = [
    "Live fixtures & ladder via Squiggle API",
    "Leg probabilities blend season averages, last-5 form, home/away splits",
    "Weather, ins/outs, ladder rank & venue advantage applied per leg",
    "Same-game correlation haircut applied to stacked markets",
  ];

  if (sportsbetStatus.configured && sportsbetStatus.connected) {
    scanNotes.push(sportsbetStatus.message);
    scanNotes.push(
      `${book.label} leg prices via The Odds API — SGM total is a product estimate (book may price correlation differently)`,
    );
  } else if (sportsbetStatus.configured) {
    scanNotes.push(sportsbetStatus.message);
    if (sportsbetStatus.lastError) scanNotes.push(sportsbetStatus.lastError);
  } else {
    scanNotes.push(
      `${book.label} not linked — set ODDS_API_KEY for live prices (the-odds-api.com)`,
    );
  }

  for (const game of selected) {
    const board = lookupSportsbetBoard(byMatchup, game.homeTeam, game.awayTeam);
    let legs;

    if (req.sportsbetOnly) {
      if (!board) {
        gamesSkippedNoBoard += 1;
        continue;
      }
      // Build from live board lines so every leg is book-priced
      legs = legsFromSportsbetBoard(board, game, bookmaker);
      const minLegsNeeded =
        mode === "legs" ? Math.min(25, Math.max(2, req.legCount ?? 3)) : 2;
      if (legs.length < minLegsNeeded) {
        gamesSkippedSparsePrices += 1;
        continue;
      }
    } else {
      const rawLegs = generateLegsForGame(game);
      legs = applySportsbetPrices(rawLegs, board, bookmaker);
    }

    const scanned = deepScanGame({
      gameId: game.id,
      matchup: `${game.homeTeam} vs ${game.awayTeam}`,
      venue: game.venue,
      round: game.round,
      legs,
      mode,
      legCount: req.legCount,
      targetOdds: req.targetOdds,
      maxSingleLegPrice: req.maxSingleLegPrice,
      maxResults: Math.ceil(maxResults / Math.max(1, Math.min(selected.length, 4))),
      sportsbetLink: board?.eventLink,
      bookmakerLabel: book.label,
      requireSportsbet: !!req.sportsbetOnly,
    });
    candidatesEvaluated += scanned.candidatesEvaluated;
    combinationsChecked += scanned.combinationsChecked;
    allMultis.push(...scanned.multis);
  }

  const minConf = Math.min(0.95, Math.max(0, req.minConfidence ?? 0));
  let multis = allMultis
    .filter((m) => m.confidence >= minConf)
    .sort((a, b) => b.edgeScore - a.edgeScore);

  // Hard gate: bookie-only means every leg must carry a live price
  if (req.sportsbetOnly) {
    multis = multis.filter(
      (m) =>
        m.sportsbetCoverage >= 0.999 &&
        m.legs.every((l) => l.sportsbetOdds != null),
    );
  }

  multis = multis.slice(0, maxResults);

  const legCap = req.maxSingleLegPrice ?? 1.35;
  if (mode === "legs") {
    scanNotes.push(`Target construction: ${req.legCount ?? 3}-leg same game multis`);
  } else {
    scanNotes.push(
      `Target price band around $${req.targetOdds ?? 10} · max 25 legs · each leg ≤ $${legCap.toFixed(2)}`,
    );
  }
  if (minConf > 0) {
    scanNotes.push(
      `Confidence floor: ${(minConf * 100).toFixed(0)}%+ (${multis.length} multis kept)`,
    );
  }
  if (req.sportsbetOnly) {
    scanNotes.push(
      `${book.label}-only: building SGMs from live ${book.shortLabel} markets only — no model fill-ins`,
    );
    if (gamesSkippedNoBoard > 0) {
      scanNotes.push(
        `Skipped ${gamesSkippedNoBoard} fixture${gamesSkippedNoBoard === 1 ? "" : "s"} with no ${book.label} board`,
      );
    }
    if (gamesSkippedSparsePrices > 0) {
      scanNotes.push(
        `Skipped ${gamesSkippedSparsePrices} fixture${gamesSkippedSparsePrices === 1 ? "" : "s"} with too few live ${book.shortLabel} props`,
      );
    }
  } else {
    scanNotes.push(
      `Model markets may appear without a ${book.shortLabel} badge when ${book.label}/Odds API has no matching line`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    mode,
    target: {
      legCount: req.legCount,
      targetOdds: req.targetOdds,
      maxSingleLegPrice: mode === "odds" ? legCap : undefined,
      minConfidence: minConf,
      sportsbetOnly: !!req.sportsbetOnly,
      bookmaker: book.id,
      bookmakerLabel: book.label,
      bookmakerShort: book.shortLabel,
    },
    gamesScanned: selected.length,
    candidatesEvaluated,
    combinationsChecked,
    multis,
    scanNotes,
    sportsbet: {
      ...sportsbetStatus,
      bookmakerId: book.id,
      bookmakerLabel: book.label,
      bookmakerShort: book.shortLabel,
    },
  };
}

export function sportsbetStatusOnly(bookmakerId?: string) {
  return getSportsbetConfigStatus(getBookmaker(bookmakerId).id);
}

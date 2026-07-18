import {
  annotateLegsWithRecentForm,
  buildBestFormMulti,
  BEST_MAX_LEG_PRICE,
  isPerfectFormSbLeg,
  isVerifiedSportsbetLeg,
} from "./engine/best-form";
import { resolveInsOuts } from "./ins-outs";
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
  SgmMulti,
  TeamId,
  TeamInsOuts,
  WeatherSnapshot,
} from "./types";
import { BOUNCE_BUILD, BOUNCE_BUILD_NOTE } from "./build-info";
import { generateLegsForGame } from "./engine/legs";
import { predictMatch } from "./engine/predict";
import {
  deepScanGame,
  selectDiverseMultis,
  seasonFormQuality,
} from "./engine/scanner";
import { applyLiveFormToPlayers, loadLiveFormForTeams } from "./live-form";
import { enrichLegsWithGuernsey } from "./guernsey";
import { getWeatherForFixture } from "./weather";
import { fetchAflInjuryRows, type AflInjuryRow } from "./afl-injuries";
import {
  fetchAflMatchRefs,
  fetchClubGuernseysFromLatestMatch,
  fetchMatchLineupInsOuts,
  findAflMatchRef,
  type RosterGuernsey,
} from "./afl-lineups";

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
  extras?: {
    weather?: WeatherSnapshot;
    homeInsOuts?: TeamInsOuts;
    awayInsOuts?: TeamInsOuts;
    rosterGuernseys?: RosterGuernsey[];
  },
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
    weather:
      extras?.weather ??
      ({
        venue: game.venue,
        condition: "clear",
        tempC: 15,
        windKmh: 12,
        rainChance: 20,
        summary: "Weather pending",
        goalMultiplier: 1,
        disposalMultiplier: 1,
        tackleMultiplier: 1,
      } satisfies WeatherSnapshot),
    homeInsOuts:
      extras?.homeInsOuts ?? resolveInsOuts({ team: game.homeTeamId }),
    awayInsOuts:
      extras?.awayInsOuts ?? resolveInsOuts({ team: game.awayTeamId }),
    homePlayers: playersForTeam(game.homeTeamId),
    awayPlayers: playersForTeam(game.awayTeamId),
    rosterGuernseys: extras?.rosterGuernseys,
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
  const [games, standings, injuriesResult, matchRefsResult] = await Promise.all([
    fetchUpcomingGames(2026),
    fetchStandings(2026),
    fetchAflInjuryRows()
      .then((rows) => ({ rows, ok: true as const }))
      .catch(() => ({ rows: [] as AflInjuryRow[], ok: false as const })),
    fetchAflMatchRefs(2026)
      .then((refs) => ({ refs, ok: true as const }))
      .catch(() => ({ refs: [], ok: false as const })),
  ]);

  const ladderByTeam = new Map(standings.map((s) => [s.team, s]));
  const injuries = injuriesResult.rows;

  // Live weather per fixture (dedupe by venue+date)
  const weatherKey = (g: FixtureGame) => `${g.venue}|${g.date}`;
  const weatherJobs = new Map<string, Promise<WeatherSnapshot>>();
  for (const g of games) {
    const key = weatherKey(g);
    if (!weatherJobs.has(key)) {
      weatherJobs.set(key, getWeatherForFixture(g.venue, g.date, g.id));
    }
  }
  const weatherEntries = await Promise.all(
    [...weatherJobs.entries()].map(async ([key, job]) => [key, await job] as const),
  );
  const weatherMap = new Map(weatherEntries);

  // Official team sheets + guernsey numbers when published (limit concurrent calls)
  const lineupByGameId = new Map<
    number,
    { home: TeamInsOuts; away: TeamInsOuts; guernseys: RosterGuernsey[] }
  >();
  const lineupTargets = games.slice(0, 12);
  await Promise.all(
    lineupTargets.map(async (g) => {
      const ref = findAflMatchRef(
        matchRefsResult.refs,
        g.round,
        g.homeTeamId,
        g.awayTeamId,
      );
      if (!ref) return;
      try {
        const lineup = await fetchMatchLineupInsOuts(
          ref.providerId,
          g.homeTeamId,
          g.awayTeamId,
        );
        if (lineup && (lineup.available || lineup.guernseys.length > 0)) {
          lineupByGameId.set(g.id, {
            home: lineup.home,
            away: lineup.away,
            guernseys: lineup.guernseys,
          });
        }
      } catch {
        /* ignore single-match failures */
      }
    }),
  );

  // Club guernsey cache from each team's latest concluded sheet — covers
  // board players when the upcoming team sheet isn't out yet.
  const clubsNeeded = [
    ...new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId])),
  ] as TeamId[];
  const clubGuernseyEntries = await Promise.all(
    clubsNeeded.map(async (teamId) => {
      try {
        const rows = await fetchClubGuernseysFromLatestMatch(
          matchRefsResult.refs,
          teamId,
        );
        return [teamId, rows] as const;
      } catch {
        return [teamId, [] as RosterGuernsey[]] as const;
      }
    }),
  );
  const clubGuernseys = new Map(clubGuernseyEntries);

  return games.map((g) => {
    const lineup = lineupByGameId.get(g.id);
    const fromSheet = lineup?.guernseys ?? [];
    const fromClubs = [
      ...(clubGuernseys.get(g.homeTeamId) ?? []),
      ...(clubGuernseys.get(g.awayTeamId) ?? []),
    ];
    // Upcoming sheet wins; fill gaps from last completed club sheets
    const byName = new Map<string, RosterGuernsey>();
    for (const row of [...fromClubs, ...fromSheet]) {
      byName.set(row.name.toLowerCase(), row);
    }
    return enrichGame(g, ladderByTeam, {
      weather: weatherMap.get(weatherKey(g)),
      homeInsOuts: resolveInsOuts({
        team: g.homeTeamId,
        lineup: lineup?.home,
        injuries,
      }),
      awayInsOuts: resolveInsOuts({
        team: g.awayTeamId,
        lineup: lineup?.away,
        injuries,
      }),
      rosterGuernseys: [...byName.values()],
    });
  });
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
  const allMultis: SgmMulti[] = [];
  const allBest: SgmMulti[] = [];
  let candidatesEvaluated = 0;
  let combinationsChecked = 0;
  let gamesSkippedNoBoard = 0;
  let gamesSkippedSparsePrices = 0;
  let gamesSkippedNoPerfectForm = 0;
  const scanNotes: string[] = [
    `Bounce build ${BOUNCE_BUILD} — ${BOUNCE_BUILD_NOTE}`,
    "Live fixtures & ladder via Squiggle API",
    "Kickoff weather via Open-Meteo (venue forecast)",
    "Injuries via AFL.com.au official injury list; team sheets via AFL match roster when published",
    "Leg probabilities blend season averages, last-5 form, home/away splits",
    "Weather, ins/outs, ladder rank & venue advantage applied per leg",
    "Same-game correlation haircut applied to stacked markets",
  ];

  if (sportsbetStatus.configured && sportsbetStatus.connected) {
    scanNotes.push(sportsbetStatus.message);
    scanNotes.push(
      `${book.label} leg prices via The Odds API — SGM total is a product estimate (book may price correlation differently)`,
    );
    if (sportsbetStatus.cached) {
      scanNotes.push(
        "Sportsbet board served from shared 12-min cache — same prices, no Odds API credit spend this scan",
      );
    }
  } else if (sportsbetStatus.configured) {
    scanNotes.push(sportsbetStatus.message);
    if (sportsbetStatus.lastError) scanNotes.push(sportsbetStatus.lastError);
    if (sportsbetStatus.quotaExhausted) {
      scanNotes.push(
        "No SB badges until Odds API credits are available — replace ODDS_API_KEY in Vercel and redeploy",
      );
    }
  } else {
    scanNotes.push(
      `${book.label} not linked — set ODDS_API_KEY for live prices (the-odds-api.com)`,
    );
  }

  const liveForm = await loadLiveFormForTeams(
    selected.flatMap((g) => [g.homeTeamId, g.awayTeamId]),
    5,
  );
  scanNotes.push(liveForm.message);

  for (const game of selected) {
    const homeLive = applyLiveFormToPlayers(game.homePlayers, liveForm.byName);
    const awayLive = applyLiveFormToPlayers(game.awayPlayers, liveForm.byName);
    const gameLive = {
      ...game,
      homePlayers: homeLive.players,
      awayPlayers: awayLive.players,
    };
    if (homeLive.matched + awayLive.matched > 0) {
      // keep quiet per game — aggregate note already added
    }

    const board = lookupSportsbetBoard(byMatchup, game.homeTeam, game.awayTeam);
    const rawLegs = generateLegsForGame(gameLive);
    let legs = applySportsbetPrices(rawLegs, board, bookmaker);
    let requireBook = false;

    // Always merge raw board lines so Over X.5 props show SB prices even when
    // Bounce model thresholds don't line up with the book.
    const boardLegsRaw = board
      ? legsFromSportsbetBoard(board, gameLive, bookmaker)
      : [];
    const boardLegs = annotateLegsWithRecentForm(
      boardLegsRaw,
      gameLive,
      liveForm.byName,
    );
    if (boardLegs.length > 0) {
      const seen = new Set(
        legs.map((l) =>
          [
            l.market,
            l.playerId ?? l.playerName ?? "",
            l.threshold ?? l.sportsbetPoint ?? "",
          ].join(":"),
        ),
      );
      for (const bl of boardLegs) {
        const key = [
          bl.market,
          bl.playerId ?? bl.playerName ?? "",
          bl.threshold ?? bl.sportsbetPoint ?? "",
        ].join(":");
        if (!seen.has(key)) {
          legs.push(bl);
          seen.add(key);
        }
      }
    }

    if (req.sportsbetOnly) {
      if (!board) {
        gamesSkippedNoBoard += 1;
        // Still scan with model legs — Odds API often has no board yet
      } else {
        const minLegsNeeded = Math.min(25, Math.max(2, req.legCount ?? 10));
        const boardOnly = boardLegs.filter(isVerifiedSportsbetLeg);

        if (boardOnly.length >= minLegsNeeded) {
          legs = boardOnly;
          requireBook = true;
        } else if (boardOnly.length >= 2) {
          // Prefer real board lines even when sparse — don't invent SB players
          legs = boardOnly;
          requireBook = true;
          gamesSkippedSparsePrices += 1;
        } else {
          gamesSkippedSparsePrices += 1;
          requireBook = false;
        }
      }
    }

    // L5 hit badges — ESPN full last-5 only
    legs = annotateLegsWithRecentForm(legs, gameLive, liveForm.byName);
    // Club colour + jumper from AFL team sheet / ESPN form / seed roster
    legs = enrichLegsWithGuernsey(legs, gameLive, liveForm.byName);

    if (req.perfectFormOnly) {
      // Strict: raw book board lines only + ESPN re-verified 5/5
      const locks = enrichLegsWithGuernsey(
        annotateLegsWithRecentForm(
          boardLegs.filter(isVerifiedSportsbetLeg),
          gameLive,
          liveForm.byName,
        ),
        gameLive,
        liveForm.byName,
      ).filter((leg) => isPerfectFormSbLeg(leg, liveForm.byName));
      if (locks.length < 2) {
        gamesSkippedNoPerfectForm += 1;
        scanNotes.push(
          `5/5 ${book.shortLabel} skipped ${game.homeTeam} vs ${game.awayTeam}: only ${locks.length} ESPN-verified lock${locks.length === 1 ? "" : "s"} on the live board (need 2+)`,
        );
      } else {
        legs = locks;
        requireBook = true;
      }
    }

    // When 5/5 mode found too few locks, don't invent non-5/5 target multis
    if (
      req.perfectFormOnly &&
      !legs.every((leg) => isPerfectFormSbLeg(leg, liveForm.byName))
    ) {
      // skip target scan for this game; BEST still runs
    } else {
      const scanned = deepScanGame({
        gameId: gameLive.id,
        matchup: `${gameLive.homeTeam} vs ${gameLive.awayTeam}`,
        venue: gameLive.venue,
        round: gameLive.round,
        legs,
        mode,
        legCount: req.legCount,
        targetOdds: req.targetOdds,
        maxSingleLegPrice: req.maxSingleLegPrice,
        maxResults: Math.ceil(maxResults / Math.max(1, Math.min(selected.length, 4))),
        sportsbetLink: board?.eventLink,
        bookmakerLabel: book.label,
        requireSportsbet: requireBook || !!req.perfectFormOnly,
      });
      candidatesEvaluated += scanned.candidatesEvaluated;
      combinationsChecked += scanned.combinationsChecked;
      allMultis.push(...scanned.multis);
    }

    // BEST: live board player-prop lines ONLY (no model→price overlays)
    const bestPool = enrichLegsWithGuernsey(
      annotateLegsWithRecentForm(
        boardLegs.filter(isVerifiedSportsbetLeg),
        gameLive,
        liveForm.byName,
      ),
      gameLive,
      liveForm.byName,
    );

    if (!board) {
      // No book board → skip BEST for this fixture (don't invent model "locks")
    } else if (bestPool.length < 2) {
      scanNotes.push(
        `BEST skipped ${game.homeTeam} vs ${game.awayTeam}: not enough live ${book.shortLabel} player props matched`,
      );
    } else {
      const best = buildBestFormMulti({
        game: gameLive,
        legs: bestPool,
        sportsbetLink: board.eventLink,
        bookmakerLabel: book.label,
        requireSportsbet: true,
        maxLegPrice: req.maxSingleLegPrice ?? BEST_MAX_LEG_PRICE,
        liveByName: liveForm.byName,
      });
      if (best) {
        best.legs = enrichLegsWithGuernsey(best.legs, gameLive, liveForm.byName);
        // Belt-and-braces: every BEST leg must be board-backed + ESPN 5/5
        if (
          best.legs.every((l) => isPerfectFormSbLeg(l, liveForm.byName))
        ) {
          allBest.push(best);
        } else {
          scanNotes.push(
            `BEST dropped ${game.homeTeam} vs ${game.awayTeam}: a lock failed ESPN 5/5 or ${book.shortLabel} board verification`,
          );
        }
      }
    }
  }

  const minConf = Math.min(0.95, Math.max(0, req.minConfidence ?? 0));
  let multis = allMultis
    .filter((m) => m.confidence >= minConf)
    .sort((a, b) => {
      const formA =
        a.legs.reduce((s, l) => s + seasonFormQuality(l), 0) /
        Math.max(a.legs.length, 1);
      const formB =
        b.legs.reduce((s, l) => s + seasonFormQuality(l), 0) /
        Math.max(b.legs.length, 1);
      return formB * 0.45 + b.edgeScore - (formA * 0.45 + a.edgeScore);
    });

  // Prefer fully live-priced multis when requested, but never blank the card
  if (req.sportsbetOnly) {
    const fullyPriced = multis.filter(
      (m) =>
        m.sportsbetCoverage >= 0.999 &&
        m.legs.every((l) => l.sportsbetOdds != null),
    );
    if (fullyPriced.length > 0) {
      multis = fullyPriced;
    } else if (multis.length > 0) {
      // Rank higher coverage first so SB badges bubble up
      multis = [...multis].sort(
        (a, b) =>
          b.sportsbetCoverage - a.sportsbetCoverage ||
          b.edgeScore - a.edgeScore,
      );
      scanNotes.push(
        `${book.label} player props are sparse on Odds API right now — showing Bounce SGMs with live ${book.shortLabel} prices where matched`,
      );
    }
  }

  if (req.perfectFormOnly) {
    const before = multis.length;
    multis = multis.filter((m) =>
      m.legs.every((leg) => isPerfectFormSbLeg(leg, liveForm.byName)),
    );
    if (before > 0 && multis.length === 0) {
      scanNotes.push(
        `No target SGM had every leg at ESPN-verified L5 5/5 with a live ${book.shortLabel} board line — try more games, a higher max leg price, or turn off 5/5 ${book.shortLabel} only`,
      );
    } else if (multis.length > 0) {
      scanNotes.push(
        `5/5 ${book.shortLabel} only: ${multis.length} multi(s) — every leg re-checked against ESPN last-5 played + live board line`,
      );
    }
  }

  // Absolute last line of defence — never return a multi that breaks the user's
  // max per-leg price or sits wildly off the target total.
  const legCap = Math.max(1.01, Number(req.maxSingleLegPrice ?? 1.65));
  const target = Math.max(1.5, Number(req.targetOdds ?? 10));
  const beforeSanitize = multis.length;
  multis = multis.filter((m) => {
    const legsOk = m.legs.every((leg) => {
      const p = Number(leg.sportsbetOdds ?? leg.odds);
      return Number.isFinite(p) && p <= legCap + 0.001;
    });
    if (!legsOk) return false;
    const total = Number(m.combinedOdds);
    if (!Number.isFinite(total)) return false;
    return total >= target * 0.88 && total <= target * 1.22;
  });
  if (beforeSanitize > 0 && multis.length === 0) {
    scanNotes.push(
      `No SGM stayed within ~$${target} (±12%) with every leg ≤ $${legCap.toFixed(2)} — try a higher max leg price, more legs, or a lower target`,
    );
  }

  // BEST multis must also respect the user's max per-leg AND keep live book + ESPN 5/5
  const beforeBest = allBest.length;
  const bestMultis = allBest.filter((m) =>
    m.legs.every((leg) => {
      const p = Number(leg.sportsbetOdds);
      return (
        isPerfectFormSbLeg(leg, liveForm.byName) &&
        Number.isFinite(p) &&
        p <= legCap + 0.001
      );
    }),
  );
  if (beforeBest > 0 && bestMultis.length < beforeBest) {
    scanNotes.push(
      `BEST: dropped ${beforeBest - bestMultis.length} multi(s) failing ESPN 5/5, board verification, or over $${legCap.toFixed(2)}`,
    );
  }

  // Final card: fewer near-duplicate player-prop remixes
  multis = selectDiverseMultis(multis, maxResults);

  scanNotes.push(
    `Target ~$${req.targetOdds ?? 15} · max ${req.legCount ?? 10} legs · each ≤ $${legCap.toFixed(2)}`,
  );
  scanNotes.push(
    `Season/form diversity: one line per player+market, then de-dupe overlapping SGMs (${multis.length} shown)`,
  );
  if (minConf > 0) {
    scanNotes.push(
      `Confidence floor: ${(minConf * 100).toFixed(0)}%+ (${multis.length} multis kept)`,
    );
  }
  if (req.perfectFormOnly) {
    scanNotes.push(
      `Filter: ESPN-verified L5 5/5 + live ${book.shortLabel} board lines only — Bounce model legs excluded`,
    );
    if (gamesSkippedNoPerfectForm > 0) {
      scanNotes.push(
        `${gamesSkippedNoPerfectForm} fixture${gamesSkippedNoPerfectForm === 1 ? "" : "s"} lacked 2+ L5 5/5 ${book.shortLabel} locks for a target multi`,
      );
    }
  } else if (req.sportsbetOnly) {
    scanNotes.push(
      `${book.label} preferred: use live ${book.shortLabel} markets when Odds API has them; Bounce fills player props when the book feed is thin`,
    );
    if (gamesSkippedNoBoard > 0) {
      scanNotes.push(
        `${gamesSkippedNoBoard} fixture${gamesSkippedNoBoard === 1 ? "" : "s"} had no ${book.label} board on Odds API`,
      );
    }
    if (gamesSkippedSparsePrices > 0) {
      scanNotes.push(
        `${gamesSkippedSparsePrices} fixture${gamesSkippedSparsePrices === 1 ? "" : "s"} only had match markets (no player props) — mixed in Bounce legs`,
      );
    }
  } else {
    scanNotes.push(
      `Model markets may appear without a ${book.shortLabel} badge when ${book.label}/Odds API has no matching line`,
    );
  }

  scanNotes.push(
    `BEST multis: ${bestMultis.length}/${selected.length} games kept · ESPN last-5 · each leg ≤ $${legCap.toFixed(2)}${boardNoteSuffix(book.shortLabel)}`,
  );

  return {
    generatedAt: new Date().toISOString(),
    mode,
    target: {
      legCount: req.legCount,
      targetOdds: req.targetOdds,
      maxSingleLegPrice: legCap,
      minConfidence: minConf,
      sportsbetOnly: !!req.sportsbetOnly,
      perfectFormOnly: !!req.perfectFormOnly,
      bookmaker: book.id,
      bookmakerLabel: book.label,
      bookmakerShort: book.shortLabel,
    },
    gamesScanned: selected.length,
    candidatesEvaluated,
    combinationsChecked,
    multis,
    bestMultis,
    scanNotes,
    sportsbet: {
      ...sportsbetStatus,
      bookmakerId: book.id,
      bookmakerLabel: book.label,
      bookmakerShort: book.shortLabel,
    },
  };
}

function boardNoteSuffix(shortLabel: string): string {
  return ` (prefer live ${shortLabel} markets)`;
}

export function sportsbetStatusOnly(bookmakerId?: string) {
  return getSportsbetConfigStatus(getBookmaker(bookmakerId).id);
}

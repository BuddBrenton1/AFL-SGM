import { TEAMS } from "../teams";
import type { EnrichedGame, FactorSignal } from "../types";
import { clamp, mean } from "./odds";

export interface MatchPrediction {
  homeWinPct: number;
  awayWinPct: number;
  /** Expected winning margin for the favourite (positive = home favoured) */
  predictedMargin: number;
  favourite: "home" | "away" | "toss-up";
  factors: FactorSignal[];
  summary: string;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function teamFormScore(game: EnrichedGame, home: boolean): number {
  const players = home ? game.homePlayers : game.awayPlayers;
  if (!players.length) return 0;
  const goals = mean(players.map((p) => p.form.goalsAvg));
  const disposals = mean(players.map((p) => p.form.disposalsAvg));
  const last5Goals = mean(players.flatMap((p) => p.form.last5Goals));
  const last5Disp = mean(players.flatMap((p) => p.form.last5Disposals));
  // Blend season + recent; scale to roughly -1..+1 contribution later
  return goals * 0.35 + disposals * 0.02 + last5Goals * 0.25 + last5Disp * 0.015;
}

function listImpact(notes: string[], outs: string[]): number {
  let score = 0;
  // Each named out hurts a bit; key words hurt more
  score -= outs.length * 0.015;
  for (const out of outs) {
    if (/injured|suspended|managed/i.test(out)) score -= 0.02;
  }
  for (const note of notes) {
    if (/out|softens|disadvantage|thin|managed/i.test(note)) score -= 0.025;
    if (/return|boost|confirmed|primary|lifts/i.test(note)) score += 0.02;
  }
  return clamp(score, -0.12, 0.08);
}

/**
 * Bounce match win model — same ingredient set as SGM legs:
 * Squiggle tip, ladder, venue/home, weather, ins/outs, player form.
 */
export function predictMatch(game: EnrichedGame): MatchPrediction {
  const factors: FactorSignal[] = [];
  // Logit space around 0 = 50/50
  let logit = 0;

  // 1) Squiggle tip baseline
  const tip = game.tipHomeWinProb ?? 0.5;
  const tipLogit = Math.log(Math.max(0.05, tip) / Math.max(0.05, 1 - tip));
  logit += tipLogit * 0.55;
  factors.push({
    key: "tip",
    label: "Model tip",
    impact: tip >= 0.55 ? "positive" : tip <= 0.45 ? "negative" : "neutral",
    detail: `Squiggle home win ${(tip * 100).toFixed(0)}%`,
    weight: (tip - 0.5) * 0.2,
  });

  // 2) Ladder rank + percentage
  const rankGap = game.awayLadder.rank - game.homeLadder.rank; // +ve => home better ranked
  const pctGap =
    (game.homeLadder.percentage - game.awayLadder.percentage) / 100;
  const ladderShift = rankGap * 0.045 + pctGap * 0.35;
  logit += ladderShift;
  factors.push({
    key: "ladder",
    label: "Ladder",
    impact: rankGap > 0 ? "positive" : rankGap < 0 ? "negative" : "neutral",
    detail: `#${game.homeLadder.rank} (${game.homeLadder.percentage.toFixed(0)}%) vs #${game.awayLadder.rank} (${game.awayLadder.percentage.toFixed(0)}%)`,
    weight: ladderShift * 0.05,
  });

  // 3) Home / venue
  const trueHome =
    game.venue === TEAMS[game.homeTeamId].primaryVenue ? 0.12 : 0.06;
  logit += trueHome;
  factors.push({
    key: "venue",
    label: "Venue",
    impact: "positive",
    detail:
      game.venue === TEAMS[game.homeTeamId].primaryVenue
        ? `Home ground advantage at ${game.venue}`
        : `Home side at ${game.venue}`,
    weight: trueHome * 0.08,
  });

  // 4) Weather — wet/wind slightly compresses strong favourites & hurts scoreboard control
  const w = game.weather;
  let weatherShift = 0;
  if (w.condition === "heavy-rain") weatherShift = tip > 0.58 ? -0.08 : 0.02;
  else if (w.condition === "light-rain") weatherShift = tip > 0.58 ? -0.04 : 0.01;
  else if (w.condition === "windy") weatherShift = tip > 0.58 ? -0.05 : 0;
  logit += weatherShift;
  factors.push({
    key: "weather",
    label: "Weather",
    impact:
      weatherShift < -0.02 ? "negative" : weatherShift > 0.02 ? "positive" : "neutral",
    detail: w.summary,
    weight: weatherShift * 0.1,
  });

  // 5) Ins / outs
  const homeList = listImpact(game.homeInsOuts.notes, game.homeInsOuts.outs);
  const awayList = listImpact(game.awayInsOuts.notes, game.awayInsOuts.outs);
  const listShift = (homeList - awayList) * 2.2;
  logit += listShift;
  factors.push({
    key: "lists",
    label: "Team lists",
    impact: listShift > 0.02 ? "positive" : listShift < -0.02 ? "negative" : "neutral",
    detail: `Home list edge ${(homeList * 100).toFixed(0)} pts · away ${(awayList * 100).toFixed(0)} pts`,
    weight: listShift * 0.08,
  });

  // 6) Past / recent player form proxy
  const homeForm = teamFormScore(game, true);
  const awayForm = teamFormScore(game, false);
  const formShift = (homeForm - awayForm) * 0.09;
  logit += formShift;
  factors.push({
    key: "form",
    label: "Player form",
    impact: formShift > 0.02 ? "positive" : formShift < -0.02 ? "negative" : "neutral",
    detail: `Attack/mid form edge ${formShift >= 0 ? "home" : "away"} (${Math.abs(formShift).toFixed(2)})`,
    weight: formShift * 0.1,
  });

  const homeWin = clamp(sigmoid(logit), 0.08, 0.92);
  const awayWin = 1 - homeWin;
  const predictedMargin = (homeWin - 0.5) * 60; // rough points scale

  let favourite: MatchPrediction["favourite"] = "toss-up";
  if (homeWin >= 0.55) favourite = "home";
  else if (awayWin >= 0.55) favourite = "away";

  const favName =
    favourite === "home"
      ? game.homeTeam
      : favourite === "away"
        ? game.awayTeam
        : "Either side";
  const favPct = Math.max(homeWin, awayWin) * 100;
  const summary =
    favourite === "toss-up"
      ? `Toss-up — home ${(homeWin * 100).toFixed(0)}% / away ${(awayWin * 100).toFixed(0)}%`
      : `${favName} ${(favPct).toFixed(0)}% · margin ~${Math.abs(predictedMargin).toFixed(0)} pts`;

  return {
    homeWinPct: homeWin,
    awayWinPct: awayWin,
    predictedMargin,
    favourite,
    factors,
    summary,
  };
}

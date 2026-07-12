import type {
  CandidateLeg,
  EnrichedGame,
  FactorSignal,
  PlayerProfile,
} from "../types";
import { isPlayerNamed } from "../ins-outs";
import {
  clamp,
  confidenceFromFactors,
  mean,
  probToOdds,
  valueScore,
} from "./odds";

function avg(nums: number[]): number {
  return mean(nums);
}

function homeAwayGoalAvg(player: PlayerProfile, isHome: boolean): number {
  return isHome ? player.form.homeGoalsAvg : player.form.awayGoalsAvg;
}

function homeAwayDispAvg(player: PlayerProfile, isHome: boolean): number {
  return isHome ? player.form.homeDisposalsAvg : player.form.awayDisposalsAvg;
}

function poissonCdfAtLeast(lambda: number, k: number): number {
  // P(X >= k) for Poisson
  let cdf = 0;
  let term = Math.exp(-lambda);
  for (let i = 0; i < k; i++) {
    cdf += term;
    term *= lambda / (i + 1);
  }
  return clamp(1 - cdf, 0.02, 0.97);
}

function normalCdfAbove(meanVal: number, std: number, threshold: number): number {
  const z = (threshold - 0.5 - meanVal) / Math.max(std, 0.5);
  // 1 - Phi(z) approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const cdf = z > 0 ? 1 - p : p;
  return clamp(1 - cdf, 0.03, 0.97);
}

function push(
  factors: FactorSignal[],
  key: string,
  label: string,
  impact: FactorSignal["impact"],
  detail: string,
  weight: number,
) {
  factors.push({ key, label, impact, detail, weight });
}

function scoreGoalLeg(
  game: EnrichedGame,
  player: PlayerProfile,
  threshold: number,
  isHome: boolean,
): CandidateLeg | null {
  const teamIns = isHome ? game.homeInsOuts : game.awayInsOuts;
  const oppIns = isHome ? game.awayInsOuts : game.homeInsOuts;
  const named = isPlayerNamed(player.name, teamIns);
  if (!named.named) return null;

  const factors: FactorSignal[] = [];
  const baseAvg = homeAwayGoalAvg(player, isHome);
  const last5 = avg(player.form.last5Goals);
  let lambda = baseAvg * 0.55 + last5 * 0.45;

  lambda *= game.weather.goalMultiplier;
  push(
    factors,
    "weather",
    "Weather",
    game.weather.goalMultiplier < 0.95
      ? "negative"
      : game.weather.goalMultiplier > 1.02
        ? "positive"
        : "neutral",
    game.weather.summary,
    (game.weather.goalMultiplier - 1) * 0.08,
  );

  // Home/away
  if (isHome) {
    push(factors, "home", "Home game", "positive", `${player.name} home goal avg ${baseAvg.toFixed(2)}`, 0.02);
  } else {
    push(factors, "away", "Away game", "negative", `Away goal avg ${baseAvg.toFixed(2)}`, -0.015);
  }

  // Ladder / mismatch
  const teamRank = isHome ? game.homeLadder.rank : game.awayLadder.rank;
  const oppRank = isHome ? game.awayLadder.rank : game.homeLadder.rank;
  const rankDelta = oppRank - teamRank;
  if (rankDelta >= 6) {
    lambda *= 1.12;
    push(factors, "ladder", "Ladder mismatch", "positive", `Rank ${teamRank} vs ${oppRank} — expected forward entries`, 0.035);
  } else if (rankDelta <= -6) {
    lambda *= 0.9;
    push(factors, "ladder", "Ladder mismatch", "negative", `Facing stronger side (rank ${oppRank})`, -0.03);
  }

  // Blowout risk helps favourite forwards
  const favHome = (game.tipHomeWinProb ?? 0.5) >= 0.58;
  const isFav = isHome ? favHome : !favHome;
  if (isFav && game.blowoutRisk > 0.45 && player.role.includes("forward")) {
    lambda *= 1.08;
    push(factors, "blowout", "Time in forward half", "positive", "Favourite projected to control territory", 0.025);
  }

  // Ins/outs
  for (const note of teamIns.notes) {
    if (/goal|forward|spearhead|tower/i.test(note)) {
      push(factors, "insouts", "Team list", "positive", note, 0.02);
      lambda *= 1.04;
    }
  }
  for (const note of oppIns.notes) {
    if (/defence|andrews|may out|softens/i.test(note)) {
      push(factors, "oppouts", "Opposition outs", "positive", note, 0.025);
      lambda *= 1.05;
    }
  }

  // Hit rate prior
  const hitKey = `${threshold}+`;
  const hist = player.form.goalHitRates[hitKey];
  let prob = poissonCdfAtLeast(lambda, threshold);
  if (hist != null) prob = clamp(prob * 0.55 + hist * 0.45, 0.05, 0.95);

  prob *= 0.92 + player.roleStability * 0.08;

  if (prob < 0.18 && threshold >= 3) return null;
  if (prob < 0.22 && threshold === 2) {
    // keep some speculative 2+
  }

  const odds = probToOdds(prob);
  const confidence = confidenceFromFactors(prob, factors);
  return {
    id: `${game.id}:goal:${player.id}:${threshold}`,
    gameId: game.id,
    market: "player_goal",
    label: `${player.name} ${threshold}+ Goals`,
    shortLabel: `${player.name.split(" ").pop()} ${threshold}+G`,
    playerId: player.id,
    playerName: player.name,
    teamId: player.team,
    threshold,
    probability: prob,
    odds,
    confidence,
    valueScore: valueScore(prob, odds),
    factors,
    correlationGroup: `goals:${player.team}`,
  };
}

function scoreDisposalLeg(
  game: EnrichedGame,
  player: PlayerProfile,
  threshold: number,
  isHome: boolean,
): CandidateLeg | null {
  const teamIns = isHome ? game.homeInsOuts : game.awayInsOuts;
  const named = isPlayerNamed(player.name, teamIns);
  if (!named.named) return null;
  if (!["midfielder", "wing", "ruck", "tagger"].includes(player.role) && player.form.disposalsAvg < 18) {
    return null;
  }

  const factors: FactorSignal[] = [];
  let meanDisp = homeAwayDispAvg(player, isHome) * 0.5 + avg(player.form.last5Disposals) * 0.5;
  meanDisp *= game.weather.disposalMultiplier;

  push(
    factors,
    "weather",
    "Weather",
    game.weather.disposalMultiplier < 0.97 ? "negative" : "neutral",
    game.weather.summary,
    (game.weather.disposalMultiplier - 1) * 0.05,
  );

  if (isHome) {
    push(factors, "home", "Home game", "positive", "Home disposal lift", 0.015);
  }

  // Teammate mid out → more ball
  const midOut = teamIns.outs.some((o) =>
    /simpkin|parish|hill|papley|martin \(managed\)/i.test(o),
  );
  if (midOut && player.role === "midfielder") {
    meanDisp *= 1.08;
    push(factors, "insouts", "Midfielder out", "positive", "Extra possessions available in midfield", 0.03);
  }

  const oppRank = isHome ? game.awayLadder.rank : game.homeLadder.rank;
  const teamRank = isHome ? game.homeLadder.rank : game.awayLadder.rank;
  if (oppRank >= 15 && teamRank <= 8) {
    meanDisp *= 1.05;
    push(factors, "ladder", "Territory control", "positive", "Likely to win more of the ball", 0.02);
  }

  const std = Math.max(3.5, meanDisp * 0.18);
  let prob = normalCdfAbove(meanDisp, std, threshold);
  const hist = player.form.disposalHitRates[`${threshold}+`];
  if (hist != null) prob = clamp(prob * 0.5 + hist * 0.5, 0.05, 0.96);
  prob *= 0.9 + player.roleStability * 0.1;

  if (prob < 0.28) return null;

  const odds = probToOdds(prob);
  const confidence = confidenceFromFactors(prob, factors);
  return {
    id: `${game.id}:disp:${player.id}:${threshold}`,
    gameId: game.id,
    market: "player_disposal",
    label: `${player.name} ${threshold}+ Disposals`,
    shortLabel: `${player.name.split(" ").pop()} ${threshold}+D`,
    playerId: player.id,
    playerName: player.name,
    teamId: player.team,
    threshold,
    probability: prob,
    odds,
    confidence,
    valueScore: valueScore(prob, odds),
    factors,
    correlationGroup: `disposals:${player.id}`,
  };
}

function scoreTackleLeg(
  game: EnrichedGame,
  player: PlayerProfile,
  threshold: number,
  isHome: boolean,
): CandidateLeg | null {
  if (player.form.tacklesAvg < 5) return null;
  const teamIns = isHome ? game.homeInsOuts : game.awayInsOuts;
  if (!isPlayerNamed(player.name, teamIns).named) return null;

  const factors: FactorSignal[] = [];
  let meanT = avg(player.form.last5Tackles) * 0.5 + player.form.tacklesAvg * 0.5;
  meanT *= game.weather.tackleMultiplier;

  if (game.weather.tackleMultiplier > 1.05) {
    push(factors, "weather", "Wet ball", "positive", "Rain lifts tackle counts", 0.04);
  }

  const underdog =
    isHome
      ? (game.tipHomeWinProb ?? 0.5) < 0.42
      : (game.tipHomeWinProb ?? 0.5) > 0.58;
  if (underdog) {
    meanT *= 1.06;
    push(factors, "role", "Chase role", "positive", "Likely to spend more time defending", 0.02);
  }

  const prob = normalCdfAbove(meanT, Math.max(1.8, meanT * 0.25), threshold);
  if (prob < 0.32) return null;
  const odds = probToOdds(prob);
  return {
    id: `${game.id}:tack:${player.id}:${threshold}`,
    gameId: game.id,
    market: "player_tackle",
    label: `${player.name} ${threshold}+ Tackles`,
    shortLabel: `${player.name.split(" ").pop()} ${threshold}+T`,
    playerId: player.id,
    playerName: player.name,
    teamId: player.team,
    threshold,
    probability: prob,
    odds,
    confidence: confidenceFromFactors(prob, factors),
    valueScore: valueScore(prob, odds),
    factors,
    correlationGroup: `tackles:${player.id}`,
  };
}

function scoreMatchLegs(game: EnrichedGame): CandidateLeg[] {
  const legs: CandidateLeg[] = [];
  const homeProb = clamp(game.tipHomeWinProb ?? 0.5, 0.2, 0.88);
  const factors: FactorSignal[] = [
    {
      key: "ladder",
      label: "Ladder",
      impact: game.homeLadder.rank < game.awayLadder.rank ? "positive" : "negative",
      detail: `${game.homeTeam} #${game.homeLadder.rank} vs ${game.awayTeam} #${game.awayLadder.rank}`,
      weight: (game.awayLadder.rank - game.homeLadder.rank) * 0.004,
    },
    {
      key: "venue",
      label: "Venue",
      impact: "positive",
      detail: `Home at ${game.venue}`,
      weight: game.homeAdvantage * 0.03,
    },
  ];

  if (homeProb >= 0.55) {
    const odds = probToOdds(homeProb);
    legs.push({
      id: `${game.id}:win:home`,
      gameId: game.id,
      market: "match_result",
      label: `${game.homeTeam} Win`,
      shortLabel: `${game.homeTeam} W`,
      teamId: game.homeTeamId,
      probability: homeProb,
      odds,
      confidence: confidenceFromFactors(homeProb, factors),
      valueScore: valueScore(homeProb, odds),
      factors,
      correlationGroup: "match-result",
    });
  }
  if (1 - homeProb >= 0.55) {
    const p = 1 - homeProb;
    const odds = probToOdds(p);
    legs.push({
      id: `${game.id}:win:away`,
      gameId: game.id,
      market: "match_result",
      label: `${game.awayTeam} Win`,
      shortLabel: `${game.awayTeam} W`,
      teamId: game.awayTeamId,
      probability: p,
      odds,
      confidence: confidenceFromFactors(p, factors),
      valueScore: valueScore(p, odds),
      factors: factors.map((f) => ({
        ...f,
        impact: f.impact === "positive" ? "negative" : f.impact === "negative" ? "positive" : "neutral",
      })),
      correlationGroup: "match-result",
    });
  }

  // Totals
  const total = game.expectedTotal * game.weather.goalMultiplier;
  for (const line of [155.5, 165.5, 175.5]) {
    const over = normalCdfAbove(total, 22, line);
    if (over >= 0.4 && over <= 0.72) {
      const odds = probToOdds(over);
      legs.push({
        id: `${game.id}:total:o${line}`,
        gameId: game.id,
        market: "total_points",
        label: `Total Points Over ${line}`,
        shortLabel: `O${line}`,
        threshold: line,
        probability: over,
        odds,
        confidence: confidenceFromFactors(over, [
          {
            key: "weather",
            label: "Weather",
            impact: game.weather.goalMultiplier < 0.95 ? "negative" : "neutral",
            detail: game.weather.summary,
            weight: (game.weather.goalMultiplier - 1) * 0.05,
          },
        ]),
        valueScore: valueScore(over, odds),
        factors: [
          {
            key: "proj",
            label: "Projected total",
            impact: "neutral",
            detail: `Model projects ~${Math.round(total)} points`,
            weight: 0,
          },
        ],
        correlationGroup: "totals",
      });
    }
  }

  return legs;
}

export function generateLegsForGame(game: EnrichedGame): CandidateLeg[] {
  const legs: CandidateLeg[] = [...scoreMatchLegs(game)];

  const consider = (players: PlayerProfile[], isHome: boolean) => {
    for (const player of players) {
      if (player.role.includes("forward") || player.form.goalsAvg >= 1.2) {
        for (const th of [1, 2, 3]) {
          const leg = scoreGoalLeg(game, player, th, isHome);
          if (leg) legs.push(leg);
        }
      }
      for (const th of [20, 25, 30]) {
        const leg = scoreDisposalLeg(game, player, th, isHome);
        if (leg) legs.push(leg);
      }
      for (const th of [5, 6, 8]) {
        const leg = scoreTackleLeg(game, player, th, isHome);
        if (leg) legs.push(leg);
      }
    }
  };

  consider(game.homePlayers, true);
  consider(game.awayPlayers, false);

  return legs.sort((a, b) => b.confidence - a.confidence);
}

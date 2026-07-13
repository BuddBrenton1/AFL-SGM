import type { MultiOutcome, SavedSgm } from "./saved-sgm";

export const PAPER_STARTING_CASH = 10_000;
export const PAPER_DEFAULT_STAKE = 50;
export const PAPER_BANKROLL_KEY = "bounce.paperBankroll.v1";

export interface PaperBankrollState {
  startingCash: number;
  /** Optional override if user resets / adjusts */
  resetAt?: string;
}

export function loadPaperBankroll(): PaperBankrollState {
  if (typeof window === "undefined") {
    return { startingCash: PAPER_STARTING_CASH };
  }
  try {
    const raw = window.localStorage.getItem(PAPER_BANKROLL_KEY);
    if (!raw) return { startingCash: PAPER_STARTING_CASH };
    const parsed = JSON.parse(raw) as PaperBankrollState;
    const starting =
      typeof parsed.startingCash === "number" && parsed.startingCash > 0
        ? parsed.startingCash
        : PAPER_STARTING_CASH;
    return { startingCash: starting, resetAt: parsed.resetAt };
  } catch {
    return { startingCash: PAPER_STARTING_CASH };
  }
}

export function persistPaperBankroll(state: PaperBankrollState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PAPER_BANKROLL_KEY, JSON.stringify(state));
}

export function resetPaperBankroll(
  startingCash = PAPER_STARTING_CASH,
): PaperBankrollState {
  const next: PaperBankrollState = {
    startingCash,
    resetAt: new Date().toISOString(),
  };
  persistPaperBankroll(next);
  return next;
}

export function isOpenPaperTrade(outcome: MultiOutcome): boolean {
  return (
    outcome === "pending" ||
    outcome === "open" ||
    outcome === "needs_stats"
  );
}

export function paperReturn(item: SavedSgm): number {
  const stake = item.stake ?? 0;
  if (stake <= 0) return 0;
  switch (item.multiOutcome) {
    case "won":
      return stake * item.combinedOdds;
    case "void":
      return stake;
    case "lost":
      return 0;
    default:
      return 0;
  }
}

export function paperProfit(item: SavedSgm): number | null {
  const stake = item.stake ?? 0;
  if (stake <= 0) return null;
  if (isOpenPaperTrade(item.multiOutcome)) return null;
  return paperReturn(item) - stake;
}

export interface PaperBankrollSummary {
  startingCash: number;
  availableCash: number;
  openStake: number;
  realizedPnl: number;
  openCount: number;
  settledCount: number;
  watchCount: number;
  equity: number;
}

/**
 * Available cash = starting − open stakes − lost stakes + won payouts
 * (voids leave cash unchanged).
 * Equity = available + open stakes (= starting + realized P&L).
 */
export function summarizePaperBankroll(
  items: SavedSgm[],
  startingCash = PAPER_STARTING_CASH,
): PaperBankrollSummary {
  let openStake = 0;
  let realizedPnl = 0;
  let openCount = 0;
  let settledCount = 0;
  let watchCount = 0;

  for (const item of items) {
    const stake = item.stake ?? 0;
    if (stake <= 0) {
      watchCount += 1;
      continue;
    }
    if (isOpenPaperTrade(item.multiOutcome)) {
      openStake += stake;
      openCount += 1;
      continue;
    }
    settledCount += 1;
    const profit = paperProfit(item);
    if (profit != null) realizedPnl += profit;
  }

  const availableCash = startingCash + realizedPnl - openStake;
  return {
    startingCash,
    availableCash,
    openStake,
    realizedPnl,
    openCount,
    settledCount,
    watchCount,
    equity: availableCash + openStake,
  };
}

export function formatAud(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (amount < 0) return `-$${formatted}`;
  return `$${formatted}`;
}

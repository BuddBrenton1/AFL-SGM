"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatOdds } from "@/lib/engine/odds";
import {
  formatAud,
  isOpenPaperTrade,
  loadPaperBankroll,
  PAPER_STARTING_CASH,
  paperProfit,
  paperReturn,
  persistPaperBankroll,
  resetPaperBankroll,
  summarizePaperBankroll,
} from "@/lib/paper-bankroll";
import {
  loadSavedSgms,
  persistSavedSgms,
  removeSavedSgm,
  upsertSavedSgm,
  type MultiOutcome,
  type SavedSgm,
} from "@/lib/saved-sgm";
import { autoSettleFromGame, type GameResultPayload } from "@/lib/settle";

const POLL_MS = 45_000;

function outcomeTone(o: MultiOutcome) {
  switch (o) {
    case "won":
      return "bg-[var(--orange)] text-[#111]";
    case "lost":
      return "bg-[#3a2420] text-[#ffb4a0]";
    case "void":
      return "bg-[#2a2a3a] text-[#b8c0ff]";
    case "needs_stats":
      return "bg-[var(--flood-soft)] text-[var(--flood)]";
    case "open":
      return "bg-black/30 text-[var(--orange)]";
    default:
      return "bg-[var(--mist)] text-[var(--muted)]";
  }
}

function outcomeLabel(o: MultiOutcome) {
  switch (o) {
    case "won":
      return "Won";
    case "lost":
      return "Lost";
    case "void":
      return "Void";
    case "needs_stats":
      return "Settling…";
    case "open":
      return "Live";
    default:
      return "Pending";
  }
}

function legTone(outcome: string) {
  if (outcome === "won") return "text-[var(--orange)]";
  if (outcome === "lost") return "text-[#ffb4a0]";
  if (outcome === "void") return "text-[#b8c0ff]";
  return "text-[var(--muted)]";
}

export function SavedSgmsSection() {
  const [items, setItems] = useState<SavedSgm[]>([]);
  const [startingCash, setStartingCash] = useState(PAPER_STARTING_CASH);
  const [hydrated, setHydrated] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastPoll, setLastPoll] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    setItems(loadSavedSgms());
    setStartingCash(loadPaperBankroll().startingCash);
    setHydrated(true);
  }, []);

  const refreshResults = useCallback(async (list: SavedSgm[]) => {
    if (!list.length) return list;
    setChecking(true);
    try {
      const next: SavedSgm[] = [];
      for (const item of list) {
        if (
          (item.multiOutcome === "won" ||
            item.multiOutcome === "lost" ||
            item.multiOutcome === "void") &&
          item.gameStatus.complete >= 100
        ) {
          next.push(item);
          continue;
        }
        try {
          const qs = item.gameStatus.espnEventId
            ? `?espnEventId=${encodeURIComponent(item.gameStatus.espnEventId)}`
            : "";
          const res = await fetch(`/api/games/${item.gameId}${qs}`);
          if (!res.ok) {
            next.push(item);
            continue;
          }
          const game = (await res.json()) as GameResultPayload;
          next.push(autoSettleFromGame(item, game));
        } catch {
          next.push(item);
        }
      }
      next.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      persistSavedSgms(next);
      setItems(next);
      setLastPoll(new Date().toISOString());
      return next;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const reload = () => {
      const list = loadSavedSgms();
      setItems(list);
      setStartingCash(loadPaperBankroll().startingCash);
      void refreshResults(list);
    };
    window.addEventListener("bounce-saved-sgms", reload);
    return () => window.removeEventListener("bounce-saved-sgms", reload);
  }, [hydrated, refreshResults]);

  useEffect(() => {
    if (!hydrated) return;
    void refreshResults(itemsRef.current);

    const id = window.setInterval(() => {
      const open = itemsRef.current.some(
        (i) =>
          i.multiOutcome !== "won" &&
          i.multiOutcome !== "lost" &&
          i.multiOutcome !== "void",
      );
      if (open) void refreshResults(itemsRef.current);
    }, POLL_MS);

    return () => window.clearInterval(id);
  }, [hydrated, refreshResults]);

  const bankroll = useMemo(
    () => summarizePaperBankroll(items, startingCash),
    [items, startingCash],
  );

  function handleDelete(id: string) {
    setItems((prev) => removeSavedSgm(id, prev));
  }

  function handleResetBankroll() {
    const ok = window.confirm(
      `Reset paper bankroll to ${formatAud(PAPER_STARTING_CASH)} and clear all paper trades?`,
    );
    if (!ok) return;
    persistSavedSgms([]);
    const next = resetPaperBankroll(PAPER_STARTING_CASH);
    setItems([]);
    setStartingCash(next.startingCash);
    window.dispatchEvent(new Event("bounce-saved-sgms"));
  }

  if (!hydrated) return null;

  return (
    <section
      id="saved"
      className="relative z-10 mx-auto max-w-7xl px-5 pb-16 md:px-8"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            className="font-[family-name:var(--font-teko)] text-4xl text-[var(--turf)]"
            style={{ fontWeight: 600 }}
          >
            Paper trades
          </h2>
          <p className="text-sm text-[var(--muted)]">
            ${PAPER_STARTING_CASH.toLocaleString("en-AU")} play money. Place a
            stake on scan results, then settle from the live box score — same
            idea as a crypto paper scanner.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => void refreshResults(items)}
              disabled={checking}
              className="border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[var(--ink)] hover:border-[var(--orange)] hover:text-[var(--orange)] disabled:opacity-60"
            >
              {checking ? "Updating…" : "Refresh now"}
            </button>
          )}
          <button
            type="button"
            onClick={handleResetBankroll}
            className="border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[var(--muted)] hover:border-[var(--orange)] hover:text-[var(--orange)]"
          >
            Reset $10k
          </button>
          {bankroll.openCount > 0 && (
            <span className="text-xs font-semibold text-[var(--muted)]">
              {bankroll.openCount} live · auto every {POLL_MS / 1000}s
            </span>
          )}
          {lastPoll && (
            <span className="text-[11px] text-[var(--muted)]">
              Updated{" "}
              {new Date(lastPoll).toLocaleTimeString("en-AU", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-[var(--line)] bg-[var(--bg-panel)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            Available
          </p>
          <p
            className="font-[family-name:var(--font-teko)] text-3xl text-[var(--ink)]"
            style={{ fontWeight: 600 }}
          >
            {formatAud(bankroll.availableCash)}
          </p>
        </div>
        <div className="border border-[var(--line)] bg-[var(--bg-panel)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            In play
          </p>
          <p
            className="font-[family-name:var(--font-teko)] text-3xl text-[var(--leather)]"
            style={{ fontWeight: 600 }}
          >
            {formatAud(bankroll.openStake)}
          </p>
        </div>
        <div className="border border-[var(--line)] bg-[var(--bg-panel)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            Realized P&amp;L
          </p>
          <p
            className={`font-[family-name:var(--font-teko)] text-3xl ${
              bankroll.realizedPnl > 0
                ? "text-[var(--orange)]"
                : bankroll.realizedPnl < 0
                  ? "text-[#ffb4a0]"
                  : "text-[var(--ink)]"
            }`}
            style={{ fontWeight: 600 }}
          >
            {bankroll.realizedPnl > 0 ? "+" : ""}
            {formatAud(bankroll.realizedPnl)}
          </p>
        </div>
        <div className="border border-[var(--line)] bg-[var(--bg-panel)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            Equity · start {formatAud(bankroll.startingCash)}
          </p>
          <p
            className="font-[family-name:var(--font-teko)] text-3xl text-[var(--ink)]"
            style={{ fontWeight: 600 }}
          >
            {formatAud(bankroll.equity)}
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="border border-[var(--line)] bg-[var(--bg-panel)] p-5 text-sm text-[var(--muted)]">
          No paper trades yet. On a scan result, set a stake and hit{" "}
          <strong className="text-[var(--ink)]">Place paper bet</strong>.
        </p>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => {
            const hits = item.legResults.filter((r) => r.outcome === "won").length;
            const misses = item.legResults.filter(
              (r) => r.outcome === "lost",
            ).length;
            const voids = item.legResults.filter(
              (r) => r.outcome === "void",
            ).length;
            const pending = item.legResults.filter(
              (r) => r.outcome === "pending",
            ).length;
            const stake = item.stake ?? 0;
            const profit = paperProfit(item);
            const toReturn = stake > 0 ? stake * item.combinedOdds : 0;

            return (
              <article
                key={item.id}
                className="border border-[var(--line)] bg-[var(--bg-panel)] p-5 md:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      Round {item.round} · {item.venue} ·{" "}
                      {stake > 0 ? "paper bet" : "watch"} ·{" "}
                      {new Date(item.savedAt).toLocaleString("en-AU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <h3
                      className="font-[family-name:var(--font-teko)] text-3xl text-[var(--ink)]"
                      style={{ fontWeight: 600 }}
                    >
                      {item.matchup}
                    </h3>
                    {(item.gameStatus.homeScore != null ||
                      item.gameStatus.espnStatusText) && (
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {item.gameStatus.espnStatusText
                          ? `${item.gameStatus.espnStatusText} · `
                          : ""}
                        {item.gameStatus.homeTeam}{" "}
                        {item.gameStatus.homeScore ?? "–"} –{" "}
                        {item.gameStatus.awayScore ?? "–"}{" "}
                        {item.gameStatus.awayTeam}
                        {item.gameStatus.complete >= 100 &&
                        item.gameStatus.winner
                          ? ` · ${item.gameStatus.winner} won`
                          : ""}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      Legs {hits} hit · {misses} miss · {voids} void · {pending}{" "}
                      live
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className="font-[family-name:var(--font-teko)] text-4xl text-[var(--leather)]"
                      style={{ fontWeight: 600 }}
                    >
                      {formatOdds(item.combinedOdds)}
                    </p>
                    {stake > 0 && (
                      <p className="mt-1 text-sm text-[var(--ink)]">
                        Stake {formatAud(stake)}
                        {isOpenPaperTrade(item.multiOutcome) ? (
                          <span className="text-[var(--muted)]">
                            {" "}
                            · to return {formatAud(toReturn)}
                          </span>
                        ) : profit != null ? (
                          <span
                            className={
                              profit > 0
                                ? "text-[var(--orange)]"
                                : profit < 0
                                  ? "text-[#ffb4a0]"
                                  : "text-[var(--muted)]"
                            }
                          >
                            {" "}
                            · {profit > 0 ? "+" : ""}
                            {formatAud(profit)}
                            {item.multiOutcome === "won"
                              ? ` (paid ${formatAud(paperReturn(item))})`
                              : ""}
                          </span>
                        ) : null}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
                      <span
                        className={`inline-block px-2 py-1 text-xs font-semibold ${outcomeTone(item.multiOutcome)}`}
                      >
                        {outcomeLabel(item.multiOutcome)}
                      </span>
                      <span className="text-xs text-[var(--muted)]">
                        {(item.confidence * 100).toFixed(0)}% model conf
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="mt-2 text-xs font-semibold text-[var(--muted)] underline"
                    >
                      {stake > 0 && isOpenPaperTrade(item.multiOutcome)
                        ? "Cancel & refund"
                        : "Remove"}
                    </button>
                  </div>
                </div>

                <ol className="mt-4 space-y-2">
                  {item.legs.map((leg, i) => {
                    const result =
                      item.legResults.find((r) => r.legId === leg.id) ?? {
                        legId: leg.id,
                        outcome: "pending" as const,
                      };

                    return (
                      <li
                        key={leg.id}
                        className="border-b border-[var(--line)] pb-2 text-sm last:border-0"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-[var(--ink)]">
                            <span className="mr-2 text-[var(--muted)]">
                              {i + 1}.
                            </span>
                            {leg.label}
                            {leg.recentFormGames != null &&
                              leg.recentFormGames > 0 && (
                                <span
                                  className={`ml-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                    leg.recentFormHits === leg.recentFormGames
                                      ? "border border-[var(--orange)] text-[var(--orange)]"
                                      : "border border-[var(--line)] text-[var(--muted)]"
                                  }`}
                                >
                                  L{leg.recentFormGames} {leg.recentFormHits}/
                                  {leg.recentFormGames}
                                </span>
                              )}
                            {result.outcome === "won" && (
                              <span className="ml-2 bg-[var(--orange)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#111]">
                                Hit
                              </span>
                            )}
                            {result.outcome === "lost" && (
                              <span className="ml-2 bg-[#3a2420] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#ffb4a0]">
                                Miss
                              </span>
                            )}
                            {result.outcome === "void" && (
                              <span className="ml-2 bg-[#2a2a3a] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#b8c0ff]">
                                Void
                              </span>
                            )}
                            {result.outcome === "pending" &&
                              result.actual != null &&
                              /benched|emergency|scratch|limited minutes|involvement/i.test(
                                result.note ?? "",
                              ) && (
                                <span className="ml-2 bg-[#2a2a3a] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#b8c0ff]">
                                  Watch
                                </span>
                              )}
                            {result.outcome === "pending" &&
                              result.actual != null && (
                                <span className="ml-2 bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--orange)]">
                                  Live {result.actual}
                                  {leg.threshold != null
                                    ? `/${leg.threshold}+`
                                    : ""}
                                </span>
                              )}
                          </span>
                          <span
                            className={`font-semibold ${legTone(result.outcome)}`}
                          >
                            {formatOdds(leg.sportsbetOdds ?? leg.odds)}
                            {result.outcome === "void"
                              ? " · void"
                              : result.actual != null &&
                                  result.outcome !== "pending"
                                ? ` · ${result.actual}`
                                : ""}
                          </span>
                        </div>
                        {result.note && (
                          <p className="mt-1 text-[11px] text-[var(--muted)]">
                            {result.note}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function useSavedSgmIds(): {
  savedIds: Set<string>;
  saveMulti: (item: SavedSgm) => void;
  refreshIds: () => void;
  availableCash: number;
} {
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [availableCash, setAvailableCash] = useState(PAPER_STARTING_CASH);

  const refreshIds = useCallback(() => {
    const list = loadSavedSgms();
    const bank = loadPaperBankroll();
    setSavedIds(new Set(list.map((x) => x.multiId)));
    setAvailableCash(summarizePaperBankroll(list, bank.startingCash).availableCash);
  }, []);

  useEffect(() => {
    refreshIds();
  }, [refreshIds]);

  const saveMulti = useCallback(
    (item: SavedSgm) => {
      const list = loadSavedSgms();
      const bank = loadPaperBankroll();
      const summary = summarizePaperBankroll(list, bank.startingCash);
      const stake = item.stake ?? 0;
      if (stake > 0 && stake > summary.availableCash + 1e-9) {
        throw new Error(
          `Not enough paper cash (need ${formatAud(stake)}, have ${formatAud(summary.availableCash)})`,
        );
      }
      upsertSavedSgm(item, list);
      persistPaperBankroll(bank);
      refreshIds();
      window.dispatchEvent(new Event("bounce-saved-sgms"));
    },
    [refreshIds],
  );

  useEffect(() => {
    const onStorage = () => refreshIds();
    window.addEventListener("bounce-saved-sgms", onStorage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("bounce-saved-sgms", onStorage);
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshIds]);

  return { savedIds, saveMulti, refreshIds, availableCash };
}

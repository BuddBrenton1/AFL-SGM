"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatOdds } from "@/lib/engine/odds";
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
      return "bg-[#cfe3d4] text-[#0c3b2e]";
    case "lost":
      return "bg-[#f0d0c0] text-[#7a3418]";
    case "needs_stats":
      return "bg-[#f3e2b0] text-[#6b4a12]";
    case "open":
      return "bg-[#dde8e2] text-[var(--turf)]";
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
    case "needs_stats":
      return "Settling…";
    case "open":
      return "Live";
    default:
      return "Pending";
  }
}

function legTone(outcome: string) {
  if (outcome === "won") return "text-[var(--turf)]";
  if (outcome === "lost") return "text-[var(--leather)]";
  return "text-[var(--muted)]";
}

export function SavedSgmsSection() {
  const [items, setItems] = useState<SavedSgm[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastPoll, setLastPoll] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    setItems(loadSavedSgms());
    setHydrated(true);
  }, []);

  const refreshResults = useCallback(async (list: SavedSgm[]) => {
    if (!list.length) return list;
    setChecking(true);
    try {
      const next: SavedSgm[] = [];
      for (const item of list) {
        if (
          (item.multiOutcome === "won" || item.multiOutcome === "lost") &&
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
      void refreshResults(list);
    };
    window.addEventListener("bounce-saved-sgms", reload);
    return () => window.removeEventListener("bounce-saved-sgms", reload);
  }, [hydrated, refreshResults]);

  // Initial settle + live poll while any SGM is still open
  useEffect(() => {
    if (!hydrated) return;
    void refreshResults(itemsRef.current);

    const id = window.setInterval(() => {
      const open = itemsRef.current.some(
        (i) => i.multiOutcome !== "won" && i.multiOutcome !== "lost",
      );
      if (open) void refreshResults(itemsRef.current);
    }, POLL_MS);

    return () => window.clearInterval(id);
  }, [hydrated, refreshResults]);

  const openCount = useMemo(
    () =>
      items.filter((i) => i.multiOutcome !== "won" && i.multiOutcome !== "lost")
        .length,
    [items],
  );

  function handleDelete(id: string) {
    setItems((prev) => removeSavedSgm(id, prev));
  }

  if (!hydrated) return null;

  return (
    <section
      id="saved"
      className="relative z-10 mx-auto max-w-6xl px-5 pb-16 md:px-8"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            className="font-[family-name:var(--font-teko)] text-4xl text-[var(--turf)]"
            style={{ fontWeight: 600 }}
          >
            Saved SGMs
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Tracks live. Player props settle automatically from the match box
            score — no input needed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => void refreshResults(items)}
              disabled={checking}
              className="rounded-full border border-[var(--line)] bg-white/70 px-4 py-2 text-sm font-semibold text-[var(--turf)] disabled:opacity-60"
            >
              {checking ? "Updating…" : "Refresh now"}
            </button>
          )}
          {openCount > 0 && (
            <span className="text-xs font-semibold text-[var(--muted)]">
              {openCount} live · auto every {POLL_MS / 1000}s
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

      {items.length === 0 ? (
        <p className="border border-[var(--line)] bg-white/50 p-5 text-sm text-[var(--muted)]">
          No saved multis yet. Hit <strong>Save SGM</strong> on a scan result to
          track it here.
        </p>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => {
            const hits = item.legResults.filter((r) => r.outcome === "won").length;
            const misses = item.legResults.filter((r) => r.outcome === "lost").length;
            const pending = item.legResults.filter((r) => r.outcome === "pending").length;

            return (
              <article
                key={item.id}
                className="border border-[var(--line)] bg-white/80 p-5 backdrop-blur md:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      Round {item.round} · {item.venue} · saved{" "}
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
                        {item.gameStatus.complete >= 100 && item.gameStatus.winner
                          ? ` · ${item.gameStatus.winner} won`
                          : ""}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      Legs {hits} hit · {misses} miss · {pending} live
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className="font-[family-name:var(--font-teko)] text-4xl text-[var(--leather)]"
                      style={{ fontWeight: 600 }}
                    >
                      {formatOdds(item.combinedOdds)}
                    </p>
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
                      Remove
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
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2 text-sm last:border-0"
                      >
                        <span className="font-medium text-[var(--ink)]">
                          <span className="mr-2 text-[var(--muted)]">{i + 1}.</span>
                          {leg.label}
                          {result.outcome === "won" && (
                            <span className="ml-2 bg-[#cfe3d4] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#0c3b2e]">
                              Hit
                            </span>
                          )}
                          {result.outcome === "lost" && (
                            <span className="ml-2 bg-[#f0d0c0] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#7a3418]">
                              Miss
                            </span>
                          )}
                          {result.outcome === "pending" && result.actual != null && (
                            <span className="ml-2 bg-[var(--mist)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--turf)]">
                              Live {result.actual}
                              {leg.threshold != null ? `/${leg.threshold}+` : ""}
                            </span>
                          )}
                        </span>
                        <span className={`font-semibold ${legTone(result.outcome)}`}>
                          {formatOdds(leg.sportsbetOdds ?? leg.odds)}
                          {result.actual != null &&
                            result.outcome !== "pending" &&
                            ` · ${result.actual}`}
                        </span>
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
} {
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const refreshIds = useCallback(() => {
    const list = loadSavedSgms();
    setSavedIds(new Set(list.map((x) => x.multiId)));
  }, []);

  useEffect(() => {
    refreshIds();
  }, [refreshIds]);

  const saveMulti = useCallback(
    (item: SavedSgm) => {
      upsertSavedSgm(item, loadSavedSgms());
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

  return { savedIds, saveMulti, refreshIds };
}

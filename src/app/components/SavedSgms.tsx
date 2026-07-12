"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatOdds } from "@/lib/engine/odds";
import {
  isPlayerMarket,
  loadSavedSgms,
  removeSavedSgm,
  upsertSavedSgm,
  type MultiOutcome,
  type SavedSgm,
} from "@/lib/saved-sgm";
import {
  autoSettleFromGame,
  markLegOutcome,
  settlePlayerLeg,
  type GameResultPayload,
} from "@/lib/settle";

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
      return "Enter stats";
    case "open":
      return "In play";
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
  const [statDrafts, setStatDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

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
          const res = await fetch(`/api/games/${item.gameId}`);
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
      const { persistSavedSgms } = await import("@/lib/saved-sgm");
      persistSavedSgms(next);
      setItems(next);
      return next;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const reload = () => setItems(loadSavedSgms());
    window.addEventListener("bounce-saved-sgms", reload);
    return () => window.removeEventListener("bounce-saved-sgms", reload);
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || items.length === 0) return;
    void refreshResults(items);
    // Only on first hydrate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const openCount = useMemo(
    () => items.filter((i) => i.multiOutcome !== "won" && i.multiOutcome !== "lost").length,
    [items],
  );

  function updateItem(next: SavedSgm) {
    setItems((prev) => upsertSavedSgm(next, prev));
  }

  function handleDelete(id: string) {
    setItems((prev) => removeSavedSgm(id, prev));
  }

  function handleStatSubmit(item: SavedSgm, legId: string) {
    const key = `${item.id}:${legId}`;
    const raw = statDrafts[key];
    const actual = Number(raw);
    if (!Number.isFinite(actual) || actual < 0) {
      setMessage("Enter a valid stat (0+)");
      return;
    }
    updateItem(settlePlayerLeg(item, legId, actual));
    setStatDrafts((d) => {
      const copy = { ...d };
      delete copy[key];
      return copy;
    });
    setMessage(null);
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
            Track picks until full time. Match winners settle automatically;
            enter player stats to close out props.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => void refreshResults(items)}
              disabled={checking}
              className="rounded-full border border-[var(--line)] bg-white/70 px-4 py-2 text-sm font-semibold text-[var(--turf)] disabled:opacity-60"
            >
              {checking ? "Checking…" : "Refresh results"}
            </button>
          )}
          {openCount > 0 && (
            <span className="text-xs font-semibold text-[var(--muted)]">
              {openCount} open
            </span>
          )}
        </div>
      </div>

      {message && (
        <p className="mb-3 text-sm text-[var(--leather)]">{message}</p>
      )}

      {items.length === 0 ? (
        <p className="border border-[var(--line)] bg-white/50 p-5 text-sm text-[var(--muted)]">
          No saved multis yet. Hit <strong>Save SGM</strong> on a scan result to
          track it here.
        </p>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
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
                  {item.gameStatus.complete >= 100 &&
                    item.gameStatus.homeScore != null && (
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        FT {item.gameStatus.homeTeam}{" "}
                        {item.gameStatus.homeScore} – {item.gameStatus.awayScore}{" "}
                        {item.gameStatus.awayTeam}
                        {item.gameStatus.winner
                          ? ` · ${item.gameStatus.winner} won`
                          : ""}
                      </p>
                    )}
                  {item.gameStatus.complete > 0 &&
                    item.gameStatus.complete < 100 && (
                      <p className="mt-1 text-sm text-[var(--turf)]">
                        In play · {item.gameStatus.complete}% complete
                        {item.gameStatus.homeScore != null
                          ? ` · ${item.gameStatus.homeScore}–${item.gameStatus.awayScore}`
                          : ""}
                      </p>
                    )}
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

              <ol className="mt-4 space-y-3">
                {item.legs.map((leg, i) => {
                  const result =
                    item.legResults.find((r) => r.legId === leg.id) ?? {
                      legId: leg.id,
                      outcome: "pending" as const,
                    };
                  const draftKey = `${item.id}:${leg.id}`;
                  const needsStat =
                    isPlayerMarket(leg.market) &&
                    result.outcome === "pending" &&
                    item.gameStatus.complete >= 100;

                  return (
                    <li
                      key={leg.id}
                      className="border-b border-[var(--line)] pb-3 text-sm last:border-0"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-[var(--ink)]">
                          <span className="mr-2 text-[var(--muted)]">{i + 1}.</span>
                          {leg.label}
                        </span>
                        <span className={`font-semibold ${legTone(result.outcome)}`}>
                          {formatOdds(leg.sportsbetOdds ?? leg.odds)}
                          {result.outcome === "won" && " · hit"}
                          {result.outcome === "lost" && " · miss"}
                          {result.outcome === "pending" &&
                            item.gameStatus.complete < 100 &&
                            " · pending"}
                          {result.actual != null && ` · actual ${result.actual}`}
                        </span>
                      </div>

                      {needsStat && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            placeholder={
                              leg.market === "player_goal"
                                ? "Goals"
                                : leg.market === "player_disposal"
                                  ? "Disposals"
                                  : leg.market === "player_tackle"
                                    ? "Tackles"
                                    : "Marks"
                            }
                            value={statDrafts[draftKey] ?? ""}
                            onChange={(e) =>
                              setStatDrafts((d) => ({
                                ...d,
                                [draftKey]: e.target.value,
                              }))
                            }
                            className="w-28 border border-[var(--line)] bg-white px-2 py-1.5 text-sm outline-none focus:border-[var(--turf)]"
                          />
                          <button
                            type="button"
                            onClick={() => handleStatSubmit(item, leg.id)}
                            className="bg-[var(--turf)] px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            Settle
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateItem(markLegOutcome(item, leg.id, "won"))
                            }
                            className="bg-[var(--mist)] px-3 py-1.5 text-xs font-semibold text-[var(--turf)]"
                          >
                            Hit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateItem(markLegOutcome(item, leg.id, "lost"))
                            }
                            className="bg-[var(--mist)] px-3 py-1.5 text-xs font-semibold text-[var(--leather)]"
                          >
                            Miss
                          </button>
                        </div>
                      )}
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
          ))}
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
      // Notify other listeners in the same tab
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

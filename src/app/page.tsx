"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ScanResult } from "@/lib/types";
import { formatOdds } from "@/lib/engine/odds";

interface FixtureCard {
  id: number;
  round: number;
  roundName: string;
  date: string;
  venue: string;
  homeTeam: string;
  awayTeam: string;
  homeRank: number;
  awayRank: number;
  tipHomeWinProb?: number;
  weather: {
    condition: string;
    tempC: number;
    windKmh: number;
    summary: string;
  };
  homeInsOuts: { ins: string[]; outs: string[]; notes: string[] };
  awayInsOuts: { ins: string[]; outs: string[]; notes: string[] };
  expectedTotal: number;
}

type Mode = "legs" | "odds";

function formatMatchDate(date: string) {
  const d = new Date(date.replace(" ", "T"));
  return d.toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function confidenceTone(c: number) {
  if (c >= 0.62) return "text-[#0c3b2e] bg-[#cfe3d4]";
  if (c >= 0.48) return "text-[#6b4a12] bg-[#f3e2b0]";
  return "text-[#7a3418] bg-[#f0d0c0]";
}

export default function HomePage() {
  const [fixtures, setFixtures] = useState<FixtureCard[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("legs");
  const [legCount, setLegCount] = useState(3);
  const [targetOdds, setTargetOdds] = useState(12);
  const [selectedGames, setSelectedGames] = useState<number[]>([]);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/fixtures");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load fixtures");
        if (!cancelled) {
          setFixtures(data.games);
          setSelectedGames(data.games.slice(0, 4).map((g: FixtureCard) => g.id));
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSet = useMemo(() => new Set(selectedGames), [selectedGames]);

  function toggleGame(id: number) {
    setSelectedGames((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function runScan() {
    setScanError(null);
    setScanning(true);
    startTransition(async () => {
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            legCount,
            targetOdds,
            gameIds: selectedGames.length ? selectedGames : undefined,
            maxResults: 12,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Scan failed");
        setResult(data);
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
      } catch (e) {
        setScanError(e instanceof Error ? e.message : "Scan failed");
      } finally {
        setScanning(false);
      }
    });
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 oval-glow" />
      <div className="pointer-events-none absolute inset-0 turf-grid opacity-60" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5 md:px-8">
        <div className="flex items-baseline gap-2">
          <span
            className="font-[family-name:var(--font-teko)] text-4xl tracking-wide text-[var(--turf)] md:text-5xl"
            style={{ fontWeight: 700 }}
          >
            BOUNCE
          </span>
          <span className="hidden text-sm text-[var(--muted)] sm:inline">
            AFL SGM Scanner
          </span>
        </div>
        <a
          href="#scanner"
          className="rounded-full bg-[var(--turf)] px-4 py-2 text-sm font-medium text-[var(--paper)] transition hover:bg-[var(--turf-deep)]"
        >
          Start scan
        </a>
      </header>

      <section className="relative z-10 mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-6 md:grid-cols-[1.15fr_0.85fr] md:px-8 md:pt-10">
        <div>
          <p className="animate-rise mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--leather)]">
            Same game · deeper cut
          </p>
          <h1
            className="animate-rise brand-stroke font-[family-name:var(--font-teko)] text-[4.4rem] leading-[0.88] text-[var(--turf-deep)] md:text-[7rem]"
            style={{ fontWeight: 600 }}
          >
            BOUNCE
          </h1>
          <p className="animate-rise-delay mt-5 max-w-xl text-lg text-[var(--muted)] md:text-xl">
            Deep-scan every AFL fixture for Same Game Multis — form, ins/outs,
            weather, ladder and venue baked into every leg.
          </p>
          <div className="animate-rise-delay-2 mt-8 flex flex-wrap gap-3">
            <a
              href="#scanner"
              className="rounded-full bg-[var(--leather)] px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(196,92,38,0.28)] transition hover:translate-y-[-1px]"
            >
              Build my multi
            </a>
            <a
              href="#fixtures"
              className="rounded-full border border-[var(--line)] bg-white/50 px-6 py-3 text-sm font-semibold text-[var(--turf)] backdrop-blur"
            >
              View fixtures
            </a>
          </div>
        </div>

        <div className="animate-rise-delay relative min-h-[280px] overflow-hidden rounded-[2px]">
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(145deg, rgba(6,37,28,0.92), rgba(12,59,46,0.75)), url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22800%22 height=%22600%22 viewBox=%220 0 800 600%22%3E%3Cellipse cx=%22400%22 cy=%22310%22 rx=%22340%22 ry=%22200%22 fill=%22none%22 stroke=%22%23e6b84a%22 stroke-width=%223%22 opacity=%220.55%22/%3E%3Cellipse cx=%22400%22 cy=%22310%22 rx=%2280%22 ry=%2248%22 fill=%22none%22 stroke=%22%23e6b84a%22 stroke-width=%222%22 opacity=%220.7%22/%3E%3Cpath d=%22M60 310 H740 M400 110 V510%22 stroke=%22%23e6b84a%22 stroke-width=%222%22 opacity=%220.35%22/%3E%3C/svg%3E') center/cover",
            }}
          />
          <div className="relative flex h-full flex-col justify-between p-6 text-[var(--paper)] md:p-8">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--flood)]">
                Live season feed
              </p>
              <p
                className="mt-2 font-[family-name:var(--font-teko)] text-5xl"
                style={{ fontWeight: 600 }}
              >
                Round {fixtures[0]?.round ?? "—"}
              </p>
              <p className="mt-1 text-sm text-white/70">
                Squiggle fixtures + ladder · modelled player markets
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="font-[family-name:var(--font-teko)] text-3xl text-[var(--flood)]">
                  {fixtures.length || "—"}
                </p>
                <p className="text-[11px] uppercase tracking-wider text-white/60">
                  Games
                </p>
              </div>
              <div>
                <p className="font-[family-name:var(--font-teko)] text-3xl text-[var(--flood)]">
                  7
                </p>
                <p className="text-[11px] uppercase tracking-wider text-white/60">
                  Factors
                </p>
              </div>
              <div>
                <p className="font-[family-name:var(--font-teko)] text-3xl text-[var(--flood)]">
                  SGM
                </p>
                <p className="text-[11px] uppercase tracking-wider text-white/60">
                  Focus
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="scanner"
        className="relative z-10 mx-auto max-w-6xl px-5 pb-10 md:px-8"
      >
        <div className="border border-[var(--line)] bg-white/70 p-5 shadow-[0_20px_60px_rgba(20,32,27,0.06)] backdrop-blur md:p-8">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2
                className="font-[family-name:var(--font-teko)] text-4xl text-[var(--turf)] md:text-5xl"
                style={{ fontWeight: 600 }}
              >
                Deep scan
              </h2>
              <p className="max-w-2xl text-sm text-[var(--muted)]">
                Choose leg count or a target price. Bounce enumerates same-game
                combinations and ranks them by confidence, edge and correlation
                risk.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("legs")}
              className={`px-4 py-2 text-sm font-semibold transition ${
                mode === "legs"
                  ? "bg-[var(--turf)] text-white"
                  : "bg-[var(--mist)] text-[var(--turf)]"
              }`}
            >
              By legs
            </button>
            <button
              type="button"
              onClick={() => setMode("odds")}
              className={`px-4 py-2 text-sm font-semibold transition ${
                mode === "odds"
                  ? "bg-[var(--turf)] text-white"
                  : "bg-[var(--mist)] text-[var(--turf)]"
              }`}
            >
              By target odds
            </button>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {mode === "legs" ? (
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Number of legs
                </span>
                <div className="mt-2 flex items-center gap-4">
                  <input
                    type="range"
                    min={2}
                    max={6}
                    value={legCount}
                    onChange={(e) => setLegCount(Number(e.target.value))}
                    className="w-full accent-[var(--leather)]"
                  />
                  <span
                    className="font-[family-name:var(--font-teko)] text-4xl text-[var(--turf)]"
                    style={{ fontWeight: 600 }}
                  >
                    {legCount}
                  </span>
                </div>
              </label>
            ) : (
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Target multi price ($)
                </span>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="number"
                    min={2}
                    max={500}
                    step={1}
                    value={targetOdds}
                    onChange={(e) => setTargetOdds(Number(e.target.value))}
                    className="w-full border border-[var(--line)] bg-white px-4 py-3 text-lg font-semibold text-[var(--ink)] outline-none focus:border-[var(--turf)]"
                  />
                  <div className="flex gap-2">
                    {[5, 10, 25, 50].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setTargetOdds(v)}
                        className="bg-[var(--mist)] px-3 py-2 text-sm font-semibold text-[var(--turf)]"
                      >
                        ${v}
                      </button>
                    ))}
                  </div>
                </div>
              </label>
            )}

            <div className="flex flex-col justify-end">
              <button
                type="button"
                onClick={runScan}
                disabled={scanning || isPending || !fixtures.length}
                className="relative overflow-hidden bg-[var(--leather)] px-6 py-4 text-left text-white transition enabled:hover:bg-[#b35020] disabled:opacity-60"
              >
                <span
                  className="font-[family-name:var(--font-teko)] text-3xl leading-none"
                  style={{ fontWeight: 600 }}
                >
                  {scanning || isPending ? "Scanning fixtures…" : "Run deep scan"}
                </span>
                <p className="mt-1 text-xs text-white/80">
                  Form · weather · lists · ladder · venue
                </p>
                {(scanning || isPending) && (
                  <span className="scan-bar absolute bottom-0 left-0 right-0 h-1 bg-[var(--flood)]" />
                )}
              </button>
              {scanError && (
                <p className="mt-2 text-sm text-[var(--leather)]">{scanError}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section
        id="fixtures"
        className="relative z-10 mx-auto max-w-6xl px-5 pb-10 md:px-8"
      >
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2
              className="font-[family-name:var(--font-teko)] text-4xl text-[var(--turf)]"
              style={{ fontWeight: 600 }}
            >
              Upcoming fixtures
            </h2>
            <p className="text-sm text-[var(--muted)]">
              Select games to include. Leave a few on for a wider scan.
            </p>
          </div>
          <button
            type="button"
            className="text-sm font-semibold text-[var(--leather)]"
            onClick={() =>
              setSelectedGames(
                selectedGames.length === fixtures.length
                  ? []
                  : fixtures.map((g) => g.id),
              )
            }
          >
            {selectedGames.length === fixtures.length ? "Clear all" : "Select all"}
          </button>
        </div>

        {loadError && (
          <p className="border border-[var(--leather)]/30 bg-[#f8ebe4] p-4 text-sm text-[var(--leather)]">
            {loadError}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {fixtures.map((g, i) => {
            const on = selectedSet.has(g.id);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleGame(g.id)}
                className={`border p-4 text-left transition ${
                  on
                    ? "border-[var(--turf)] bg-white shadow-[0_8px_24px_rgba(12,59,46,0.08)]"
                    : "border-transparent bg-white/40 hover:bg-white/70"
                }`}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      {g.roundName} · {formatMatchDate(g.date)}
                    </p>
                    <p
                      className="mt-1 font-[family-name:var(--font-teko)] text-2xl text-[var(--ink)]"
                      style={{ fontWeight: 600 }}
                    >
                      {g.homeTeam}{" "}
                      <span className="text-[var(--muted)]">vs</span> {g.awayTeam}
                    </p>
                    <p className="text-sm text-[var(--muted)]">
                      {g.venue} · #{g.homeRank} vs #{g.awayRank} · proj{" "}
                      {g.expectedTotal} pts
                    </p>
                  </div>
                  <span
                    className={`mt-1 h-5 w-5 shrink-0 rounded-full border-2 ${
                      on
                        ? "border-[var(--turf)] bg-[var(--flood)]"
                        : "border-[var(--stone)]"
                    }`}
                  />
                </div>
                <p className="mt-3 text-xs text-[var(--muted)]">{g.weather.summary}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <span className="bg-[var(--mist)] px-2 py-1 text-[var(--turf)]">
                    {g.weather.condition} · {g.weather.tempC}°C · {g.weather.windKmh}km/h
                  </span>
                  {g.tipHomeWinProb != null && (
                    <span className="bg-[var(--mist)] px-2 py-1 text-[var(--turf)]">
                      Home win {(g.tipHomeWinProb * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section
        id="results"
        className="relative z-10 mx-auto max-w-6xl px-5 pb-20 md:px-8"
      >
        <h2
          className="font-[family-name:var(--font-teko)] text-4xl text-[var(--turf)]"
          style={{ fontWeight: 600 }}
        >
          Scan results
        </h2>

        {!result && (
          <p className="mt-3 text-sm text-[var(--muted)]">
            Run a deep scan to surface ranked Same Game Multis.
          </p>
        )}

        {result && (
          <div className="mt-4">
            <div className="mb-6 flex flex-wrap gap-4 text-sm text-[var(--muted)]">
              <span>
                {result.gamesScanned} games · {result.candidatesEvaluated} legs ·{" "}
                {result.combinationsChecked.toLocaleString()} combos
              </span>
              <span>
                Mode: {result.mode === "legs" ? `${result.target.legCount} legs` : `~$${result.target.targetOdds}`}
              </span>
            </div>

            <div className="grid gap-4">
              {result.multis.map((m, idx) => (
                <article
                  key={m.id}
                  className="animate-rise border border-[var(--line)] bg-white/80 p-5 backdrop-blur md:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                        #{idx + 1} · Round {m.round} · {m.venue}
                      </p>
                      <h3
                        className="font-[family-name:var(--font-teko)] text-3xl text-[var(--ink)]"
                        style={{ fontWeight: 600 }}
                      >
                        {m.matchup}
                      </h3>
                    </div>
                    <div className="text-right">
                      <p
                        className="font-[family-name:var(--font-teko)] text-4xl text-[var(--leather)]"
                        style={{ fontWeight: 600 }}
                      >
                        {formatOdds(m.combinedOdds)}
                      </p>
                      <span
                        className={`inline-block px-2 py-1 text-xs font-semibold ${confidenceTone(m.confidence)}`}
                      >
                        {(m.confidence * 100).toFixed(0)}% confidence
                      </span>
                    </div>
                  </div>

                  <ol className="mt-4 space-y-2">
                    {m.legs.map((leg, i) => (
                      <li
                        key={leg.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2 text-sm last:border-0"
                      >
                        <span className="font-medium text-[var(--ink)]">
                          <span className="mr-2 text-[var(--muted)]">{i + 1}.</span>
                          {leg.label}
                        </span>
                        <span className="text-[var(--muted)]">
                          {formatOdds(leg.odds)} · {(leg.probability * 100).toFixed(0)}%
                        </span>
                      </li>
                    ))}
                  </ol>

                  {m.rationale.length > 0 && (
                    <ul className="mt-4 space-y-1 text-xs text-[var(--muted)]">
                      {m.rationale.map((r) => (
                        <li key={r}>→ {r}</li>
                      ))}
                    </ul>
                  )}

                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-[var(--turf)]">
                      Factor breakdown
                    </summary>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {m.legs.map((leg) => (
                        <div key={leg.id} className="bg-[var(--mist)]/70 p-3">
                          <p className="text-sm font-semibold text-[var(--ink)]">
                            {leg.shortLabel}
                          </p>
                          <ul className="mt-2 space-y-1">
                            {leg.factors.map((f) => (
                              <li key={f.key + f.detail} className="text-xs text-[var(--muted)]">
                                <span
                                  className={
                                    f.impact === "positive"
                                      ? "text-[var(--turf)]"
                                      : f.impact === "negative"
                                        ? "text-[var(--leather)]"
                                        : ""
                                  }
                                >
                                  {f.label}
                                </span>
                                : {f.detail}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </details>
                </article>
              ))}
            </div>

            {result.multis.length === 0 && (
              <p className="mt-4 text-sm text-[var(--muted)]">
                No multis matched that target. Try a wider odds band or fewer legs.
              </p>
            )}

            <div className="mt-8 border-t border-[var(--line)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Scan notes
              </p>
              <ul className="mt-2 space-y-1 text-xs text-[var(--muted)]">
                {result.scanNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-[var(--muted)]">
                Odds are model estimates for research — not bookmaker prices. Gamble responsibly.
              </p>
            </div>
          </div>
        )}
      </section>

      <footer className="relative z-10 border-t border-[var(--line)] bg-[var(--turf-deep)] px-5 py-8 text-[var(--paper)] md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <p
            className="font-[family-name:var(--font-teko)] text-3xl"
            style={{ fontWeight: 600 }}
          >
            BOUNCE
          </p>
          <p className="text-sm text-white/60">
            AFL Same Game Multi scanner · live ladder & fixtures
          </p>
        </div>
      </footer>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  BOOKMAKERS,
  DEFAULT_BOOKMAKER,
  getBookmaker,
  type BookmakerId,
} from "@/lib/bookmakers";
import type { ScanResult } from "@/lib/types";
import { formatOdds } from "@/lib/engine/odds";
import { createSavedSgm } from "@/lib/saved-sgm";
import { SavedSgmsSection, useSavedSgmIds } from "./components/SavedSgms";

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
  prediction?: {
    homeWinPct: number;
    awayWinPct: number;
    predictedMargin: number;
    favourite: "home" | "away" | "toss-up";
    summary: string;
    factors: { key: string; label: string; impact: string; detail: string }[];
  };
}

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
  if (c >= 0.62) return "text-[#111] bg-[var(--orange)]";
  if (c >= 0.48) return "text-[var(--orange)] bg-[var(--flood-soft)]";
  return "text-[#ffb4a0] bg-[#3a2420]";
}

export default function HomePage() {
  const [fixtures, setFixtures] = useState<FixtureCard[]>([]);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [legCount, setLegCount] = useState(10);
  const [targetOdds, setTargetOdds] = useState(15);
  const [maxSingleLegPrice, setMaxSingleLegPrice] = useState(1.65);
  const [minConfidencePct, setMinConfidencePct] = useState(60);
  const [sportsbetOnly, setSportsbetOnly] = useState(false);
  const [bookmaker, setBookmaker] = useState<BookmakerId>(DEFAULT_BOOKMAKER);
  const [selectedGames, setSelectedGames] = useState<number[]>([]);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [scanning, setScanning] = useState(false);
  const [sportsbetStatus, setSportsbetStatus] = useState<{
    configured: boolean;
    connected: boolean;
    message: string;
    bookmakerId?: string;
    bookmakerLabel?: string;
    bookmakerShort?: string;
    remainingRequests?: number | null;
  } | null>(null);

  const book = useMemo(() => getBookmaker(bookmaker), [bookmaker]);
  const resultBook = useMemo(
    () =>
      getBookmaker(
        result?.target.bookmaker ??
          result?.sportsbet?.bookmakerId ??
          bookmaker,
      ),
    [result, bookmaker],
  );
  const { savedIds, saveMulti } = useSavedSgmIds();
  const [saveFlash, setSaveFlash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [fixRes, sbRes] = await Promise.all([
          fetch("/api/fixtures"),
          fetch(`/api/sportsbet?bookmaker=${encodeURIComponent(bookmaker)}`),
        ]);
        const data = await fixRes.json();
        const sb = await sbRes.json();
        if (!fixRes.ok) throw new Error(data.error || "Failed to load fixtures");
        if (!cancelled) {
          const games = data.games as FixtureCard[];
          const upcomingRound = games[0]?.round ?? null;
          setFixtures(games);
          setSelectedRound(upcomingRound);
          setSelectedGames(
            upcomingRound == null
              ? []
              : games.filter((g) => g.round === upcomingRound).map((g) => g.id),
          );
          setSportsbetStatus(sb);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Initial fixture load only — bookmaker status refreshes below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sbRes = await fetch(
          `/api/sportsbet?bookmaker=${encodeURIComponent(bookmaker)}`,
        );
        const sb = await sbRes.json();
        if (!cancelled) setSportsbetStatus(sb);
      } catch {
        /* keep prior status */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookmaker]);

  const selectedSet = useMemo(() => new Set(selectedGames), [selectedGames]);

  const rounds = useMemo(() => {
    const map = new Map<number, string>();
    for (const g of fixtures) {
      if (!map.has(g.round)) map.set(g.round, g.roundName);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, roundName]) => ({ round, roundName }));
  }, [fixtures]);

  const roundFixtures = useMemo(
    () =>
      selectedRound == null
        ? []
        : fixtures.filter((g) => g.round === selectedRound),
    [fixtures, selectedRound],
  );

  const selectedRoundName =
    rounds.find((r) => r.round === selectedRound)?.roundName ??
    (selectedRound != null ? `Round ${selectedRound}` : "—");

  function selectRound(round: number) {
    setSelectedRound(round);
    setSelectedGames(
      fixtures.filter((g) => g.round === round).map((g) => g.id),
    );
  }

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
            mode: "odds",
            legCount,
            targetOdds,
            maxSingleLegPrice,
            minConfidence: minConfidencePct / 100,
            sportsbetOnly,
            bookmaker,
            gameIds: selectedGames.length ? selectedGames : undefined,
            maxResults: 12,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Scan failed");
        setResult(data);
        if (data.sportsbet) setSportsbetStatus(data.sportsbet);
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

      <header className="relative z-10 border-b border-[var(--line)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 md:px-8">
          <div className="flex items-baseline gap-3">
            <span
              className="font-[family-name:var(--font-teko)] text-4xl tracking-wide text-[var(--ink)] md:text-5xl"
              style={{ fontWeight: 700 }}
            >
              BOUNCE
            </span>
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--orange)] sm:inline">
              AFL SGM
            </span>
          </div>
          <nav className="flex items-center gap-5 md:gap-7">
            <a href="#fixtures" className="nav-link hidden sm:inline">
              Fixtures
            </a>
            <a href="#scanner" className="nav-link hidden sm:inline">
              Scanner
            </a>
            <a href="#saved" className="nav-link">
              Saved
            </a>
            <div
              className="hidden items-center gap-2 border border-[var(--line)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-strong)] md:flex"
              title={sportsbetStatus?.message}
            >
              <span
                className={`h-1.5 w-1.5 ${
                  sportsbetStatus?.connected
                    ? "bg-[var(--orange)]"
                    : sportsbetStatus?.configured
                      ? "bg-[var(--flood)]"
                      : "bg-[var(--stone)]"
                }`}
              />
              {book.label}{" "}
              {sportsbetStatus?.connected
                ? "live"
                : sportsbetStatus?.configured
                  ? "keyed"
                  : "off"}
            </div>
          </nav>
        </div>
      </header>

      <section className="relative z-10 mx-auto grid max-w-7xl gap-10 px-5 pb-14 pt-10 md:grid-cols-[1.2fr_0.8fr] md:px-8 md:pt-14">
        <div>
          <p className="animate-rise mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-[var(--orange)]">
            Same game · deeper cut
          </p>
          <h1
            className="animate-rise font-[family-name:var(--font-teko)] text-[4.6rem] leading-[0.86] text-[var(--ink)] md:text-[7.2rem]"
            style={{ fontWeight: 600 }}
          >
            BOUN<span className="text-[var(--orange)]">CE</span>
          </h1>
          <p className="animate-rise-delay mt-5 max-w-xl text-base text-[var(--muted-strong)] md:text-lg">
            Deep-scan every AFL fixture for Same Game Multis — form, ins/outs,
            weather, ladder and venue baked into every leg.
          </p>
          <div className="animate-rise-delay-2 mt-8 flex flex-wrap gap-3">
            <a href="#scanner" className="btn-primary">
              Build my multi
            </a>
            <a href="#fixtures" className="btn-ghost">
              View fixtures
            </a>
          </div>
        </div>

        <div className="animate-rise-delay relative min-h-[260px] overflow-hidden border border-[var(--line)] bg-[var(--bg-raised)]">
          <div className="hero-ring" />
          <div className="hero-ring-2" />
          <div className="relative flex h-full flex-col justify-between p-6 md:p-8">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--orange)]">
                Live season feed
              </p>
              <p
                className="mt-2 font-[family-name:var(--font-teko)] text-5xl text-[var(--ink)]"
                style={{ fontWeight: 600 }}
              >
                Round {selectedRound ?? "—"}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Squiggle fixtures + ladder · modelled player markets
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="border border-[var(--line)] bg-black/20 p-3">
                <p className="font-[family-name:var(--font-teko)] text-3xl text-[var(--orange)]">
                  {roundFixtures.length || "—"}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                  Games
                </p>
              </div>
              <div className="border border-[var(--line)] bg-black/20 p-3">
                <p className="font-[family-name:var(--font-teko)] text-3xl text-[var(--orange)]">
                  7
                </p>
                <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                  Factors
                </p>
              </div>
              <div className="border border-[var(--line)] bg-black/20 p-3">
                <p className="font-[family-name:var(--font-teko)] text-3xl text-[var(--orange)]">
                  SGM
                </p>
                <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                  Focus
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="scanner"
        className="relative z-10 mx-auto max-w-7xl px-5 pb-10 md:px-8"
      >
        <div className="panel p-5 md:p-8">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2
                className="font-[family-name:var(--font-teko)] text-4xl text-[var(--turf)] md:text-5xl"
                style={{ fontWeight: 600 }}
              >
                Deep scan
              </h2>
              <p className="max-w-2xl text-sm text-[var(--muted)]">
                Set your target payout, max price per leg, max legs and
                confidence floor. Bounce builds same-game multis to match —
                overlaying {book.label} prices when linked.
              </p>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              What platform are you using?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {BOOKMAKERS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBookmaker(b.id)}
                  className={`px-3 py-2 text-sm font-semibold transition ${
                    bookmaker === b.id
                      ? "bg-[var(--orange)] text-[#111]"
                      : "border border-[var(--line)] text-[var(--muted-strong)] hover:border-[var(--orange)] hover:text-[var(--orange)]"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className={`mt-5 border px-4 py-3 text-sm ${
              sportsbetStatus?.configured
                ? "border-[var(--orange)]/30 bg-black/25 text-[var(--muted-strong)]"
                : "border-[var(--orange)]/40 bg-[var(--paper-warm)] text-[var(--flood)]"
            }`}
          >
            <p className="font-semibold text-[var(--ink)]">
              {book.label}{" "}
              {sportsbetStatus?.connected
                ? "· live prices"
                : sportsbetStatus?.configured
                  ? "· key set"
                  : "· not linked"}
            </p>
            <p className="mt-1 text-xs opacity-90">
              {sportsbetStatus?.message ??
                `Add ODDS_API_KEY from the-odds-api.com to pull live ${book.label} AFL prices.`}
            </p>
            {!sportsbetStatus?.configured && (
              <p className="mt-2 text-xs">
                Copy <code className="bg-black/40 px-1 text-[var(--orange)]">.env.example</code> →{" "}
                <code className="bg-black/40 px-1 text-[var(--orange)]">.env.local</code>, set{" "}
                <code className="bg-black/40 px-1 text-[var(--orange)]">ODDS_API_KEY</code>, restart.
              </p>
            )}
            {sportsbetStatus?.remainingRequests != null && (
              <p className="mt-1 text-xs opacity-80">
                Odds API credits remaining: {sportsbetStatus.remainingRequests}
              </p>
            )}
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="space-y-5">
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
                    className="w-full border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-3 text-lg font-semibold text-[var(--ink)] outline-none focus:border-[var(--orange)]"
                  />
                  <div className="flex gap-2">
                    {[5, 10, 15, 25, 50].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setTargetOdds(v)}
                        className={`border px-3 py-2 text-sm font-semibold ${
                          targetOdds === v
                            ? "border-[var(--orange)] bg-[var(--orange)] text-[#111]"
                            : "border-[var(--line)] text-[var(--muted-strong)] hover:border-[var(--orange)] hover:text-[var(--orange)]"
                        }`}
                      >
                        ${v}
                      </button>
                    ))}
                  </div>
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Max price per leg
                </span>
                <div className="mt-2 flex items-center gap-4">
                  <input
                    type="range"
                    min={1.1}
                    max={2.5}
                    step={0.05}
                    value={maxSingleLegPrice}
                    onChange={(e) =>
                      setMaxSingleLegPrice(Number(Number(e.target.value).toFixed(2)))
                    }
                    className="w-full accent-[var(--leather)]"
                  />
                  <span
                    className="min-w-[4.5rem] text-right font-[family-name:var(--font-teko)] text-4xl text-[var(--turf)]"
                    style={{ fontWeight: 600 }}
                  >
                    ${maxSingleLegPrice.toFixed(2)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[1.2, 1.35, 1.5, 1.65, 1.8, 2.0].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setMaxSingleLegPrice(v)}
                      className={`px-2.5 py-1 text-xs font-semibold ${
                        Math.abs(maxSingleLegPrice - v) < 0.001
                          ? "bg-[var(--orange)] text-[#111]"
                          : "border border-[var(--line)] text-[var(--muted-strong)] hover:border-[var(--orange)]"
                      }`}
                    >
                      ${v.toFixed(2)}
                    </button>
                  ))}
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Max legs
                </span>
                <div className="mt-2 flex items-center gap-4">
                  <input
                    type="range"
                    min={2}
                    max={25}
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
                <div className="mt-2 flex flex-wrap gap-2">
                  {[3, 4, 5, 6, 8, 10, 12].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setLegCount(v)}
                      className={`px-2.5 py-1 text-xs font-semibold ${
                        legCount === v
                          ? "bg-[var(--orange)] text-[#111]"
                          : "border border-[var(--line)] text-[var(--muted-strong)] hover:border-[var(--orange)]"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Theoretical max ≈ $
                  {Math.pow(maxSingleLegPrice, legCount).toFixed(1)} with{" "}
                  {legCount} × ${maxSingleLegPrice.toFixed(2)} legs
                  {Math.pow(maxSingleLegPrice, legCount) < targetOdds * 0.7
                    ? " — raise max price or legs to reach your target"
                    : ""}
                  .
                </p>
              </label>
            </div>

            <div className="flex flex-col gap-5">
              <label className="block">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Minimum confidence
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {minConfidencePct === 0
                      ? "No floor"
                      : `${minConfidencePct}%+ average leg hit-rate`}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-4">
                  <input
                    type="range"
                    min={0}
                    max={80}
                    step={5}
                    value={minConfidencePct}
                    onChange={(e) => setMinConfidencePct(Number(e.target.value))}
                    className="w-full accent-[var(--leather)]"
                  />
                  <span
                    className="min-w-[4.5rem] text-right font-[family-name:var(--font-teko)] text-4xl text-[var(--turf)]"
                    style={{ fontWeight: 600 }}
                  >
                    {minConfidencePct}%
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[0, 40, 50, 60, 70].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setMinConfidencePct(v)}
                      className={`px-2.5 py-1 text-xs font-semibold ${
                        minConfidencePct === v
                          ? "bg-[var(--orange)] text-[#111]"
                          : "border border-[var(--line)] text-[var(--muted-strong)] hover:border-[var(--orange)]"
                      }`}
                    >
                      {v === 0 ? "Any" : `${v}%+`}
                    </button>
                  ))}
                </div>
              </label>

              <button
                type="button"
                onClick={runScan}
                disabled={scanning || isPending || !selectedGames.length}
                className="btn-scan mt-auto"
              >
                <span className="btn-scan-label">
                  {scanning || isPending ? "Scanning…" : "Find multis"}
                </span>
                <span className="btn-scan-meta">
                  ~${targetOdds} · ≤{legCount} legs · ≤${maxSingleLegPrice.toFixed(2)} ·{" "}
                  {minConfidencePct === 0 ? "any conf" : `${minConfidencePct}%+`}
                </span>
                {(scanning || isPending) && (
                  <span className="scan-bar absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--orange)]" />
                )}
              </button>
              {scanError && (
                <p className="text-sm text-[var(--leather)]">{scanError}</p>
              )}
            </div>
          </div>

          <label className="mt-6 flex cursor-pointer items-start gap-3 border border-[var(--line)] bg-black/20 p-4">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[var(--turf)]"
              checked={sportsbetOnly}
              onChange={(e) => setSportsbetOnly(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--ink)]">
                Prefer {book.label} prices
              </span>
              <span className="mt-1 block text-xs text-[var(--muted)]">
                Rank live {book.label} prices first ({book.shortLabel} badge).
                Odds API often only has AFL match markets — Bounce still fills
                player props so the scan isn’t empty.
              </span>
            </span>
          </label>
        </div>
      </section>

      <section
        id="fixtures"
        className="relative z-10 mx-auto max-w-7xl px-5 pb-10 md:px-8"
      >
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              className="font-[family-name:var(--font-teko)] text-4xl text-[var(--turf)]"
              style={{ fontWeight: 600 }}
            >
              {selectedRoundName}
            </h2>
            <p className="text-sm text-[var(--muted)]">
              Select games to include. Leave a few on for a wider scan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-[var(--muted-strong)]">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Round
              </span>
              <select
                className="round-select"
                value={selectedRound ?? ""}
                disabled={!rounds.length}
                onChange={(e) => selectRound(Number(e.target.value))}
              >
                {rounds.map((r) => (
                  <option key={r.round} value={r.round}>
                    {r.roundName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="text-sm font-semibold text-[var(--leather)]"
              onClick={() =>
                setSelectedGames(
                  selectedGames.length === roundFixtures.length &&
                    roundFixtures.every((g) => selectedSet.has(g.id))
                    ? []
                    : roundFixtures.map((g) => g.id),
                )
              }
            >
              {selectedGames.length === roundFixtures.length &&
              roundFixtures.length > 0 &&
              roundFixtures.every((g) => selectedSet.has(g.id))
                ? "Clear all"
                : "Select all"}
            </button>
          </div>
        </div>

        {loadError && (
          <p className="border border-[var(--orange)]/30 bg-[var(--paper-warm)] p-4 text-sm text-[var(--flood)]">
            {loadError}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roundFixtures.map((g, i) => {
            const on = selectedSet.has(g.id);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleGame(g.id)}
                className={`fixture-card p-3.5 text-left ${
                  on ? "is-on" : "hover:border-[var(--orange)]/70"
                }`}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      {formatMatchDate(g.date)}
                    </p>
                    <p
                      className="mt-1 font-[family-name:var(--font-teko)] text-[1.35rem] leading-none text-[var(--ink)]"
                      style={{ fontWeight: 600 }}
                    >
                      {g.homeTeam}
                    </p>
                    <p
                      className="font-[family-name:var(--font-teko)] text-[1.35rem] leading-none text-[var(--ink)]"
                      style={{ fontWeight: 600 }}
                    >
                      <span className="mr-1 text-[var(--muted)]">vs</span>
                      {g.awayTeam}
                    </p>
                    <p className="mt-1.5 truncate text-xs text-[var(--muted)]">
                      {g.venue} · #{g.homeRank}/#{g.awayRank}
                    </p>
                  </div>
                  <span
                    className={`mt-0.5 h-4 w-4 shrink-0 rounded-md border-2 ${
                      on
                        ? "border-[var(--orange)] bg-[var(--orange)]"
                        : "border-[var(--orange)]/50"
                    }`}
                  />
                </div>

                {g.prediction && (
                  <div className="mt-2.5 rounded-xl border border-[var(--orange)]/25 bg-black/25 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                        Win %
                      </p>
                      <p className="truncate text-[10px] font-medium text-[var(--turf)]">
                        {g.prediction.summary}
                      </p>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      <div
                        className={`p-1.5 ${
                          g.prediction.favourite === "home"
                            ? "bg-[var(--orange)] text-[#111]"
                            : "bg-[var(--bg-hover)] text-[var(--ink)]"
                        }`}
                      >
                        <p className="truncate text-[9px] uppercase tracking-wide opacity-80">
                          {g.homeTeam}
                        </p>
                        <p
                          className="font-[family-name:var(--font-teko)] text-2xl leading-none"
                          style={{ fontWeight: 600 }}
                        >
                          {(g.prediction.homeWinPct * 100).toFixed(0)}%
                        </p>
                      </div>
                      <div
                        className={`p-1.5 ${
                          g.prediction.favourite === "away"
                            ? "bg-[var(--orange)] text-[#111]"
                            : "bg-[var(--bg-hover)] text-[var(--ink)]"
                        }`}
                      >
                        <p className="truncate text-[9px] uppercase tracking-wide opacity-80">
                          {g.awayTeam}
                        </p>
                        <p
                          className="font-[family-name:var(--font-teko)] text-2xl leading-none"
                          style={{ fontWeight: 600 }}
                        >
                          {(g.prediction.awayWinPct * 100).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden bg-black/40">
                      <div
                        className="h-full bg-[var(--leather)]"
                        style={{
                          width: `${Math.round(g.prediction.homeWinPct * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  <span className="bg-black/30 px-1.5 py-0.5 text-[var(--orange)]">
                    {g.weather.condition} · {g.weather.tempC}°C
                  </span>
                  <span className="bg-black/30 px-1.5 py-0.5 text-[var(--muted)]">
                    proj {g.expectedTotal}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section
        id="results"
        className="relative z-10 mx-auto max-w-7xl px-5 pb-20 md:px-8"
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
                Mode: ~${result.target.targetOdds} · ≤{result.target.legCount ?? 10}{" "}
                legs · each ≤ $
                {(result.target.maxSingleLegPrice ?? 1.65).toFixed(2)}
              </span>
              {(result.target.minConfidence ?? 0) > 0 && (
                <span>
                  Confidence ≥ {Math.round((result.target.minConfidence ?? 0) * 100)}%
                </span>
              )}
              {result.target.sportsbetOnly && (
                <span>Prefer {resultBook.label} prices</span>
              )}
            </div>

            <div className="grid gap-4">
              {result.multis.map((m, idx) => (
                <article
                  key={m.id}
                  className="animate-rise border border-[var(--line)] bg-[var(--bg-panel)] p-5 md:p-6"
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
                      <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
                        <span
                          className={`inline-block px-2 py-1 text-xs font-semibold ${confidenceTone(m.confidence)}`}
                          title="Average estimated hit-rate of the legs, minus a correlation haircut"
                        >
                          {(m.confidence * 100).toFixed(0)}% confidence
                        </span>
                        {m.sportsbetCoverage > 0 && (
                          <span className="inline-block bg-[var(--orange)] px-2 py-1 text-xs font-semibold text-[#111]">
                            {resultBook.shortLabel}{" "}
                            {Math.round(m.sportsbetCoverage * 100)}%
                            {m.sportsbetCombinedOdds != null
                              ? ` · ${formatOdds(m.sportsbetCombinedOdds)}`
                              : ""}
                          </span>
                        )}
                      </div>
                      {m.sportsbetLink && (
                        <a
                          href={m.sportsbetLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block text-xs font-semibold text-[var(--leather)] underline"
                        >
                          Open on {resultBook.label}
                        </a>
                      )}
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => {
                            const saved = createSavedSgm(m, {
                              bookmaker: resultBook.id,
                              bookmakerLabel: resultBook.label,
                            });
                            saveMulti(saved);
                            setSaveFlash(m.id);
                            setTimeout(() => setSaveFlash(null), 2000);
                          }}
                          className={`px-3 py-1.5 text-xs font-semibold transition ${
                            savedIds.has(m.id) || saveFlash === m.id
                              ? "bg-[var(--orange)] text-[#111]"
                              : "border border-[var(--orange)] text-[var(--orange)] hover:bg-[var(--flood-soft)]"
                          }`}
                        >
                          {savedIds.has(m.id) || saveFlash === m.id
                            ? "Saved ✓"
                            : "Save SGM"}
                        </button>
                      </div>
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
                          {leg.sportsbetOdds != null && (
                            <span className="ml-2 bg-[var(--orange)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#111]">
                              {resultBook.shortLabel}
                              {leg.sportsbetSelection
                                ? ` · ${leg.sportsbetSelection}`
                                : ""}
                            </span>
                          )}
                        </span>
                        <span className="text-[var(--muted)]">
                          {leg.sportsbetOdds != null ? (
                            <>
                              <span className="font-semibold text-[var(--turf)]">
                                {resultBook.shortLabel} {formatOdds(leg.sportsbetOdds)}
                              </span>
                              {leg.modelOdds != null && (
                                <span className="ml-2 text-xs">
                                  model {formatOdds(leg.modelOdds)}
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              {formatOdds(leg.odds)} · {(leg.probability * 100).toFixed(0)}%
                            </>
                          )}
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
                        <div key={leg.id} className="bg-black/25 p-3">
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
              <div className="mt-4 space-y-2 border border-[var(--line)] bg-black/25 p-4 text-sm text-[var(--muted)]">
                <p className="font-semibold text-[var(--ink)]">No multis found</p>
                <p>
                  {result.target.sportsbetOnly
                    ? `No multis found even with Bounce fill-ins. Try fewer legs, a wider odds band, lower confidence, or more fixtures.`
                    : "Try a wider odds band, fewer legs, lower confidence, or select more fixtures."}
                </p>
              </div>
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
                {resultBook.label} prices come from The Odds API when{" "}
                <code>ODDS_API_KEY</code> is set. Combined SGM is a product of
                individual {resultBook.label} legs — the book may price
                correlation differently. Gamble responsibly.
              </p>
            </div>
          </div>
        )}
      </section>

      <SavedSgmsSection />

      <footer className="relative z-10 border-t border-[var(--line)] bg-black px-5 py-8 text-[var(--ink)] md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <p
            className="font-[family-name:var(--font-teko)] text-3xl"
            style={{ fontWeight: 600 }}
          >
            BOUNCE
          </p>
          <p className="text-sm text-[var(--muted)]">
            AFL Same Game Multi scanner · live ladder & fixtures
          </p>
        </div>
      </footer>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  BOOKMAKERS,
  DEFAULT_BOOKMAKER,
  getBookmaker,
  type BookmakerId,
} from "@/lib/bookmakers";
import {
  formatAud,
  PAPER_DEFAULT_STAKE,
} from "@/lib/paper-bankroll";
import { BOUNCE_BUILD } from "@/lib/build-info";
import { formatOdds } from "@/lib/engine/odds";
import { createSavedSgm } from "@/lib/saved-sgm";
import { formatSgmForBookmaker } from "@/lib/sgm-export";
import { resolveTeamIdLoose } from "@/lib/teams";
import type { ScanResult, SgmMulti, TeamId } from "@/lib/types";
import { SavedSgmsSection, useSavedSgmIds } from "./components/SavedSgms";
import { SgmMultiCard } from "./components/SgmMultiCard";

interface FixtureCard {
  id: number;
  round: number;
  roundName: string;
  date: string;
  venue: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamId?: TeamId;
  awayTeamId?: TeamId;
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

interface MatchH2hPrice {
  homeTeam: string;
  awayTeam: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeOdds: number;
  awayOdds: number;
  eventLink?: string;
  lastUpdate?: string;
}

function findFixtureH2h(
  prices: MatchH2hPrice[],
  homeTeam: string,
  awayTeam: string,
  homeTeamId?: TeamId,
  awayTeamId?: TeamId,
): MatchH2hPrice | undefined {
  const homeId = homeTeamId ?? resolveTeamIdLoose(homeTeam) ?? undefined;
  const awayId = awayTeamId ?? resolveTeamIdLoose(awayTeam) ?? undefined;

  // TeamId match only — never substring ("Melbourne" ⊆ "North Melbourne")
  if (homeId && awayId) {
    return prices.find(
      (p) =>
        (p.homeTeamId === homeId && p.awayTeamId === awayId) ||
        (p.homeTeamId === awayId && p.awayTeamId === homeId),
    );
  }

  return undefined;
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

export default function HomePage() {
  const [fixtures, setFixtures] = useState<FixtureCard[]>([]);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [legCount, setLegCount] = useState(10);
  const [targetOdds, setTargetOdds] = useState(15);
  const [maxSingleLegPrice, setMaxSingleLegPrice] = useState(1.65);
  const [minConfidencePct, setMinConfidencePct] = useState(60);
  const [sportsbetOnly, setSportsbetOnly] = useState(false);
  const [perfectFormOnly, setPerfectFormOnly] = useState(false);
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
    lastError?: string;
    quotaExhausted?: boolean;
    cached?: boolean;
    cachedAt?: string;
  } | null>(null);
  const [matchPrices, setMatchPrices] = useState<MatchH2hPrice[]>([]);
  const [matchPricesLoading, setMatchPricesLoading] = useState(false);

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
  const { savedIds, saveMulti, availableCash } = useSavedSgmIds();
  const [saveFlash, setSaveFlash] = useState<string | null>(null);
  const [copyFlash, setCopyFlash] = useState<string | null>(null);
  const [paperStake, setPaperStake] = useState(PAPER_DEFAULT_STAKE);
  const [paperError, setPaperError] = useState<string | null>(null);

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

  // Live H2H for fixture tiles — 1 Odds API credit / slate, cached ~12 min
  useEffect(() => {
    let cancelled = false;
    setMatchPricesLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/match-odds?bookmaker=${encodeURIComponent(bookmaker)}`,
        );
        const data = await res.json();
        if (cancelled) return;
        setMatchPrices(Array.isArray(data.prices) ? data.prices : []);
        if (data.status) setSportsbetStatus(data.status);
      } catch {
        if (!cancelled) setMatchPrices([]);
      } finally {
        if (!cancelled) setMatchPricesLoading(false);
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

  function placePaperBet(m: SgmMulti) {
    setPaperError(null);
    try {
      const saved = createSavedSgm(m, {
        bookmaker: resultBook.id,
        bookmakerLabel: resultBook.label,
        stake: paperStake,
      });
      saveMulti(saved);
      setSaveFlash(m.id);
      setTimeout(() => setSaveFlash(null), 2000);
      document.getElementById("saved")?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      setPaperError(
        e instanceof Error ? e.message : "Could not place paper bet",
      );
    }
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
            perfectFormOnly,
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
              Paper
            </a>
            <div
              className="hidden items-center gap-2 border border-[var(--line)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-strong)] md:flex"
              title={
                sportsbetStatus?.lastError
                  ? `${sportsbetStatus.message} — ${sportsbetStatus.lastError}`
                  : sportsbetStatus?.message
              }
            >
              <span
                className={`h-1.5 w-1.5 ${
                  sportsbetStatus?.quotaExhausted
                    ? "bg-[var(--flood)]"
                    : sportsbetStatus?.connected
                      ? "bg-[var(--orange)]"
                      : sportsbetStatus?.configured
                        ? "bg-[var(--flood)]"
                        : "bg-[var(--stone)]"
                }`}
              />
              {book.label}{" "}
              {sportsbetStatus?.quotaExhausted
                ? "quota"
                : sportsbetStatus?.connected
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
              sportsbetStatus?.quotaExhausted
                ? "border-[var(--flood)]/50 bg-[var(--paper-warm)] text-[var(--flood)]"
                : sportsbetStatus?.connected
                  ? "border-[var(--orange)]/30 bg-black/25 text-[var(--muted-strong)]"
                  : sportsbetStatus?.configured
                    ? "border-[var(--orange)]/40 bg-black/25 text-[var(--muted-strong)]"
                    : "border-[var(--orange)]/40 bg-[var(--paper-warm)] text-[var(--flood)]"
            }`}
          >
            <p className="font-semibold text-[var(--ink)]">
              {book.label}{" "}
              {sportsbetStatus?.quotaExhausted
                ? "· quota exhausted"
                : sportsbetStatus?.connected
                  ? "· live prices"
                  : sportsbetStatus?.configured
                    ? "· key set"
                    : "· not linked"}
            </p>
            <p className="mt-1 text-xs opacity-90">
              {sportsbetStatus?.message ??
                `Add ODDS_API_KEY from the-odds-api.com to pull live ${book.label} AFL prices.`}
            </p>
            {sportsbetStatus?.lastError && (
              <p className="mt-2 text-xs font-medium text-[var(--flood)]">
                {sportsbetStatus.lastError}
              </p>
            )}
            {!sportsbetStatus?.configured && (
              <p className="mt-2 text-xs">
                Copy <code className="bg-black/40 px-1 text-[var(--orange)]">.env.example</code> →{" "}
                <code className="bg-black/40 px-1 text-[var(--orange)]">.env.local</code>, set{" "}
                <code className="bg-black/40 px-1 text-[var(--orange)]">ODDS_API_KEY</code>, restart.
                On Vercel, set the same env var and redeploy.
              </p>
            )}
            {sportsbetStatus?.quotaExhausted && (
              <p className="mt-2 text-xs">
                Get a fresh key at{" "}
                <a
                  href="https://the-odds-api.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--orange)] underline"
                >
                  the-odds-api.com
                </a>
                , set <code className="bg-black/40 px-1">ODDS_API_KEY</code> on Vercel, redeploy.
                Until then every leg is Bounce model-only (no SB badge).
              </p>
            )}
            {sportsbetStatus?.remainingRequests != null && (
              <p className="mt-1 text-xs opacity-80">
                Odds API credits remaining: {sportsbetStatus.remainingRequests}
                {sportsbetStatus.cached
                  ? " · board from shared cache (no credit spend)"
                  : ""}
              </p>
            )}
            {sportsbetStatus?.cached &&
              sportsbetStatus.remainingRequests == null && (
                <p className="mt-1 text-xs opacity-80">
                  Board from shared cache (no Odds API credit spend)
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
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Hard ceiling — Bounce prefers legs near this price (not tiny
                  $1.05 fillers).
                </p>
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
                  {perfectFormOnly
                    ? `5/5 ${book.shortLabel}`
                    : minConfidencePct === 0
                      ? "any conf"
                      : `${minConfidencePct}%+`}
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
              disabled={perfectFormOnly}
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--ink)]">
                Prefer {book.label} prices
              </span>
              <span className="mt-1 block text-xs text-[var(--muted)]">
                Rank live {book.label} prices first ({book.shortLabel} badge).
                Odds API often only has AFL match markets — Bounce still fills
                player props so the scan isn’t empty.
                {perfectFormOnly
                  ? ` Covered by 5/5 ${book.shortLabel} only below.`
                  : ""}
              </span>
            </span>
          </label>

          <label className="mt-3 flex cursor-pointer items-start gap-3 border border-[var(--orange)]/40 bg-black/20 p-4">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[var(--orange)]"
              checked={perfectFormOnly}
              onChange={(e) => {
                const on = e.target.checked;
                setPerfectFormOnly(on);
                if (on) setSportsbetOnly(true);
              }}
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--ink)]">
                5/5 {book.shortLabel} only
              </span>
              <span className="mt-1 block text-xs text-[var(--muted)]">
                Every leg must be a live {book.shortLabel} board line and clear
                the line in all of the last 5 games played (ESPN-verified L5
                5/5). Bounce model legs and partial form windows are excluded.
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
              {matchPricesLoading
                ? ` · loading ${book.shortLabel} prices…`
                : matchPrices.length > 0
                  ? ` · live ${book.shortLabel} H2H on tiles`
                  : ""}
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
            const homeId = g.homeTeamId ?? resolveTeamIdLoose(g.homeTeam);
            const awayId = g.awayTeamId ?? resolveTeamIdLoose(g.awayTeam);
            const h2h = findFixtureH2h(
              matchPrices,
              g.homeTeam,
              g.awayTeam,
              homeId ?? undefined,
              awayId ?? undefined,
            );
            const sameOrientation =
              h2h &&
              homeId &&
              awayId &&
              h2h.homeTeamId === homeId &&
              h2h.awayTeamId === awayId;
            const homePrice = h2h
              ? sameOrientation
                ? h2h.homeOdds
                : h2h.awayOdds
              : null;
            const awayPrice = h2h
              ? sameOrientation
                ? h2h.awayOdds
                : h2h.homeOdds
              : null;
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
                    <div className="mt-1 flex items-baseline justify-between gap-2">
                      <p
                        className="min-w-0 truncate font-[family-name:var(--font-teko)] text-[1.35rem] leading-none text-[var(--ink)]"
                        style={{ fontWeight: 600 }}
                      >
                        {g.homeTeam}
                      </p>
                      {homePrice != null && (
                        <span className="shrink-0 font-[family-name:var(--font-teko)] text-xl leading-none text-[var(--leather)]"
                          style={{ fontWeight: 600 }}
                        >
                          {formatOdds(homePrice)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <p
                        className="min-w-0 truncate font-[family-name:var(--font-teko)] text-[1.35rem] leading-none text-[var(--ink)]"
                        style={{ fontWeight: 600 }}
                      >
                        <span className="mr-1 text-[var(--muted)]">vs</span>
                        {g.awayTeam}
                      </p>
                      {awayPrice != null && (
                        <span className="shrink-0 font-[family-name:var(--font-teko)] text-xl leading-none text-[var(--leather)]"
                          style={{ fontWeight: 600 }}
                        >
                          {formatOdds(awayPrice)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-xs text-[var(--muted)]">
                      {g.venue} · #{g.homeRank}/#{g.awayRank}
                      {h2h
                        ? ` · ${book.shortLabel}`
                        : matchPricesLoading
                          ? ` · ${book.shortLabel}…`
                          : ""}
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
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap gap-4 text-sm text-[var(--muted)]">
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
                    Confidence ≥{" "}
                    {Math.round((result.target.minConfidence ?? 0) * 100)}%
                  </span>
                )}
                {result.target.sportsbetOnly && (
                  <span>Prefer {resultBook.label} prices</span>
                )}
                {result.target.perfectFormOnly && (
                  <span>5/5 {resultBook.shortLabel} only</span>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-right">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Paper stake
                  </span>
                  <div className="mt-1 flex items-center gap-1">
                    <span className="text-sm text-[var(--muted)]">$</span>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, Math.floor(availableCash))}
                      step={5}
                      value={paperStake}
                      onChange={(e) =>
                        setPaperStake(
                          Math.max(1, Number(e.target.value) || PAPER_DEFAULT_STAKE),
                        )
                      }
                      className="w-24 border border-[var(--line)] bg-black/30 px-2 py-1.5 text-sm text-[var(--ink)]"
                    />
                  </div>
                </label>
                <a
                  href="#saved"
                  className="border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:border-[var(--orange)] hover:text-[var(--orange)]"
                >
                  Cash {formatAud(availableCash)}
                </a>
              </div>
            </div>
            {paperError && (
              <p className="mb-4 border border-[#5a3030] bg-[#2a1818] px-3 py-2 text-sm text-[#ffb4a0]">
                {paperError}
              </p>
            )}

            {(result.bestMultis?.length ?? 0) > 0 && (
              <div className="mb-10">
                <div className="mb-4">
                  <h3
                    className="font-[family-name:var(--font-teko)] text-3xl text-[var(--orange)]"
                    style={{ fontWeight: 600 }}
                  >
                    BEST per game
                  </h3>
                  <p className="text-sm text-[var(--muted)]">
                    ESPN last-5 only + live {resultBook.label} prices only (no
                    Bounce model odds). Must clear all 5 recent games and stay
                    under your max per-leg. Build{" "}
                    <span className="font-semibold text-[var(--orange)]">
                      {BOUNCE_BUILD}
                    </span>
                    .
                  </p>
                </div>
                <div className="grid gap-4">
                  {result.bestMultis.map((m) => (
                    <SgmMultiCard
                      key={m.id}
                      multi={m}
                      indexLabel={`${m.legs.length}-leg BEST`}
                      book={resultBook}
                      badge="100% recent form"
                      paperStake={paperStake}
                      availableCash={availableCash}
                      saved={savedIds.has(m.id)}
                      saveFlash={saveFlash === m.id}
                      copyFlash={copyFlash === m.id}
                      onCopy={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            formatSgmForBookmaker(m, resultBook.label),
                          );
                          setCopyFlash(m.id);
                          setTimeout(() => setCopyFlash(null), 2000);
                        } catch {
                          setCopyFlash(null);
                        }
                      }}
                      onPlace={() => placePaperBet(m)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <h3
                className="font-[family-name:var(--font-teko)] text-3xl text-[var(--turf)]"
                style={{ fontWeight: 600 }}
              >
                Target builds
              </h3>
              <p className="text-sm text-[var(--muted)]">
                Ranked SGMs near your ~${result.target.targetOdds} target with
                the max per-leg / max-legs caps.
              </p>
            </div>

            <div className="grid gap-4">
              {result.multis.map((m, idx) => (
                <SgmMultiCard
                  key={m.id}
                  multi={m}
                  indexLabel={`#${idx + 1}`}
                  book={resultBook}
                  paperStake={paperStake}
                  availableCash={availableCash}
                  saved={savedIds.has(m.id)}
                  saveFlash={saveFlash === m.id}
                  copyFlash={copyFlash === m.id}
                  onCopy={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        formatSgmForBookmaker(m, resultBook.label),
                      );
                      setCopyFlash(m.id);
                      setTimeout(() => setCopyFlash(null), 2000);
                    } catch {
                      setCopyFlash(null);
                    }
                  }}
                  onPlace={() => placePaperBet(m)}
                />
              ))}
            </div>

            {result.multis.length === 0 && (
              <div className="mt-4 space-y-2 border border-[var(--line)] bg-black/25 p-4 text-sm text-[var(--muted)]">
                <p className="font-semibold text-[var(--ink)]">No multis found</p>
                <p>
                  Nothing landed near ~${result.target.targetOdds} with ≤$
                  {(result.target.maxSingleLegPrice ?? 1.65).toFixed(2)} legs and
                  ≤{result.target.legCount ?? 10} selections. Raise max per-leg /
                  max legs, lower the target, or ease confidence.
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
            AFL Same Game Multi scanner · live ladder & fixtures · build{" "}
            {BOUNCE_BUILD}
          </p>
        </div>
      </footer>
    </main>
  );
}

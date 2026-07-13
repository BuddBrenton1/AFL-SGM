"use client";

import type { BookmakerOption } from "@/lib/bookmakers";
import { formatOdds } from "@/lib/engine/odds";
import { formatAud } from "@/lib/paper-bankroll";
import type { SgmMulti } from "@/lib/types";

function confidenceTone(c: number) {
  if (c >= 0.72) return "bg-[var(--orange)] text-[#111]";
  if (c >= 0.58) return "bg-[var(--flood-soft)] text-[var(--flood)]";
  return "bg-[var(--mist)] text-[var(--muted)]";
}

export function SgmMultiCard(props: {
  multi: SgmMulti;
  indexLabel: string;
  book: BookmakerOption;
  badge?: string;
  paperStake: number;
  availableCash: number;
  saved: boolean;
  saveFlash: boolean;
  copyFlash: boolean;
  onCopy: () => void;
  onPlace: () => void;
}) {
  const {
    multi: m,
    indexLabel,
    book,
    badge,
    paperStake,
    availableCash,
    saved,
    saveFlash,
    copyFlash,
    onCopy,
    onPlace,
  } = props;

  return (
    <article className="animate-rise border border-[var(--line)] bg-[var(--bg-panel)] p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            {indexLabel} · Round {m.round} · {m.venue}
          </p>
          <h3
            className="font-[family-name:var(--font-teko)] text-3xl text-[var(--ink)]"
            style={{ fontWeight: 600 }}
          >
            {m.matchup}
          </h3>
          {badge && (
            <span className="mt-2 inline-block bg-[var(--orange)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#111]">
              {badge}
            </span>
          )}
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
                {book.shortLabel} {Math.round(m.sportsbetCoverage * 100)}%
                {m.sportsbetCombinedOdds != null
                  ? ` · ${formatOdds(m.sportsbetCombinedOdds)}`
                  : ""}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {m.sportsbetLink && (
              <a
                href={m.sportsbetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--leather)] hover:border-[var(--orange)] hover:text-[var(--orange)]"
              >
                Open match on {book.label}
              </a>
            )}
            <button
              type="button"
              onClick={onCopy}
              className="border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:border-[var(--orange)] hover:text-[var(--orange)]"
              title="Books don't allow auto-loading a full SGM slip — copy the checklist and rebuild it on the match page"
            >
              {copyFlash ? "Copied ✓" : "Copy for bet slip"}
            </button>
            <button
              type="button"
              onClick={onPlace}
              disabled={paperStake > availableCash + 1e-9}
              className={`px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                saved || saveFlash
                  ? "bg-[var(--orange)] text-[#111]"
                  : "border border-[var(--orange)] text-[var(--orange)] hover:bg-[var(--flood-soft)]"
              }`}
            >
              {saved || saveFlash
                ? "Bet placed ✓"
                : `Place paper bet · ${formatAud(paperStake)}`}
            </button>
          </div>
          <p className="mt-2 max-w-xs text-right text-[10px] leading-snug text-[var(--muted)]">
            Paper only — to return {formatAud(paperStake * m.combinedOdds)}.
            One-click SGM slips aren&apos;t offered by AU books; open the match
            to rebuild live.
          </p>
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
                  {book.shortLabel}
                  {leg.sportsbetSelection ? ` · ${leg.sportsbetSelection}` : ""}
                </span>
              )}
              {leg.factors.some((f) => f.key === "best-form") && (
                <span className="ml-2 border border-[var(--orange)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--orange)]">
                  {leg.factors
                    .find((f) => f.key === "best-form")
                    ?.detail.match(/^L\d+\s+\d+\/\d+/)?.[0] ?? "L5 lock"}
                </span>
              )}
            </span>
            <span className="flex items-center gap-2 text-[var(--muted)]">
              {leg.sportsbetOdds != null ? (
                <>
                  <span className="font-semibold text-[var(--turf)]">
                    {book.shortLabel} {formatOdds(leg.sportsbetOdds)}
                  </span>
                  <span className="ml-1">
                    · {(leg.confidence * 100).toFixed(0)}%
                  </span>
                  {leg.modelOdds != null &&
                    Math.abs(leg.modelOdds - leg.sportsbetOdds) > 0.02 && (
                      <span className="ml-2 text-xs">
                        model {formatOdds(leg.modelOdds)}
                      </span>
                    )}
                </>
              ) : (
                <>
                  {formatOdds(leg.odds)} · {(leg.confidence * 100).toFixed(0)}%
                </>
              )}
              {leg.sportsbetLink && (
                <a
                  href={leg.sportsbetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-semibold uppercase tracking-wide text-[var(--orange)] hover:underline"
                  title={`Open this market on ${book.label}`}
                >
                  Open
                </a>
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
  );
}

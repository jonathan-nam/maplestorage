"use client";

import { useEffect, useState } from "react";

import { apiAssetUrl } from "@/lib/api";
import { BOSS_ART } from "@/lib/boss-art";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatDuration, type NightPerson, planAsText } from "@/lib/boss-night";
import type { Plan } from "@/lib/boss-run-plan";

/**
 * The night, in order.
 *
 * A run says who is on which character, and marks the people who had to change to start it. The
 * marks are the point of the whole tool, so they are on the seat that moved rather than summarised
 * at the end of the row.
 */
export function RunPlan({ plan, roster }: { plan: Plan; roster: NightPerson[] }) {
  const nameOf = (id: string) => roster.find((person) => person.id === id)?.name ?? id;

  return (
    <ol className="run-list">
      {plan.runs.map((planned) => {
        const switched = new Set(planned.switched);
        return (
          <li key={planned.run.id} className="run-row">
            <span className="run-time">{formatDuration(planned.startsAt)}</span>
            {BOSS_ART[planned.run.bossKey] ? (
              <img
                className="run-art"
                src={apiAssetUrl(BOSS_ART[planned.run.bossKey] as string)}
                alt=""
                width={40}
                height={40}
              />
            ) : (
              <span className="run-art is-empty" aria-hidden="true" />
            )}
            <span className="run-boss">
              <span className="run-boss-name">
                {bossLabel(planned.run.bossName, planned.run.difficulty)}
              </span>
              <span className="run-boss-minutes">{formatDuration(planned.run.minutes)}</span>
            </span>
            <ul className="run-seats">
              {planned.run.seats.map((seat) => (
                <li
                  key={seat.character}
                  className={switched.has(seat.personId) ? "run-seat is-switch" : "run-seat"}
                  title={
                    switched.has(seat.personId)
                      ? `${nameOf(seat.personId)} switches to ${seat.character}`
                      : undefined
                  }
                >
                  {switched.has(seat.personId) && (
                    <span className="run-swap" aria-hidden="true">
                      &#8644;
                    </span>
                  )}
                  <span className="run-seat-character">{seat.character}</span>
                  <span className="run-seat-person">{nameOf(seat.personId)}</span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

/** The plan as text on the clipboard, which is where a party actually reads it. */
export function CopyPlan({ plan, roster }: { plan: Plan; roster: NightPerson[] }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={copied ? "copy-amount copied" : "copy-amount"}
      onClick={() => {
        navigator.clipboard
          ?.writeText(planAsText(plan, roster))
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      <span className="copy-value">{copied ? "Copied" : "Copy the order"}</span>
    </button>
  );
}

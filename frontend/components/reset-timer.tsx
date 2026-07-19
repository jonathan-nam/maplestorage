"use client";

import { useEffect, useState } from "react";
import { formatCountdown, msUntil, serverNowMs } from "@/lib/reset-countdown";

// Weekly leads because 16 of the 19 bosses are weekly; the other two cadences follow it, smaller.
// The order is deliberate and not CADENCE_ORDER's: that one runs MONTHLY -> DAILY to match the
// planner's own layout, which is about grouping rows, not about which clock you are watching.
const TIMER_ORDER = ["WEEKLY", "DAILY", "MONTHLY"] as const;

const LABELS: Record<string, string> = {
  WEEKLY: "Weekly reset",
  DAILY: "Daily",
  MONTHLY: "Monthly",
};

const TICK_MS = 1000;

/**
 * Time until each cadence resets, on the server's clock.
 *
 * The instants are served (see BossClearsViewResponse.nextResets); this only counts down to them.
 * Recomputing "next Thursday" here would put a second implementation of the reset boundary in the
 * codebase, and the two silently disagreeing is exactly the failure the matrix is built to avoid.
 */
export function ResetTimer({
  nextResets,
  serverNow,
  receivedAt,
}: {
  nextResets: Record<string, string>;
  serverNow: string;
  receivedAt: number;
}) {
  // Seeded from the clock rather than set in the effect. Safe from a hydration mismatch because
  // this only renders once the clears have arrived over the network, so it never runs on the
  // server. A first frame of "–" would otherwise flash on every load.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // A cadence the response did not carry is skipped rather than shown counting to nothing.
  const cadences = TIMER_ORDER.flatMap((cadence) => {
    const at = nextResets[cadence];
    return at ? [{ cadence, at }] : [];
  });
  if (cadences.length === 0) return null;

  return (
    <p className="reset-timer">
      {cadences.map(({ cadence, at }, i) => {
        const remaining = msUntil(at, serverNowMs(serverNow, receivedAt, now));
        return (
          <span key={cadence} className={i === 0 ? "reset-lead" : "reset-minor"}>
            <span className="reset-label">{LABELS[cadence] ?? cadence}</span>
            <span className="reset-value">{formatCountdown(remaining)}</span>
          </span>
        );
      })}
      <span className="reset-zone" title="Bosses reset at 00:00 UTC; weeklies on Thursday.">
        UTC
      </span>
    </p>
  );
}

import { record } from "./timing";

// Real User Monitoring: report page-load metrics from real browsers to the backend, so
// "how slow is the site for actual users, and from where" is a log query rather than a
// guess made on a developer's fast local connection.
//
// This is the production-facing sibling of timing.ts. timing.ts prints per-request
// splits to the dev console; this beacons a small, anonymous payload to /api/vitals for
// every (sampled) real load. No user id, no IP: location is coarse (timezone, locale),
// which answers "slow loads come from Australia" without logging who.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;
const ASSET_VERSION = process.env.NEXT_PUBLIC_ASSET_VERSION;

// Fraction of page loads that report. 1 = everyone. Env-tunable so a traffic spike can
// be dialled down without shipping code.
const SAMPLE_RATE = Number(process.env.NEXT_PUBLIC_RUM_SAMPLE_RATE ?? "1");

// Decided ONCE per page load, not per metric. A sampled-in load must report all of its
// metrics or the per-load picture is half-missing, and web-vitals arrive at different
// times (some only on pagehide).
const sampledIn = typeof window !== "undefined" && Math.random() < SAMPLE_RATE;

export type Metric = {
  name: string;
  value: number;
  rating?: string;
  id?: string;
};

// The coarse, anonymous context every report carries. Read fresh per report: connection
// and route can both change during a session.
function context() {
  const nav = (
    performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
  )?.type;
  // Non-standard but widely shipped; absent on Safari/Firefox, hence optional.
  const conn = (navigator as { connection?: { effectiveType?: string } }).connection?.effectiveType;
  const device = window.matchMedia("(max-width: 768px)").matches ? "mobile" : "desktop";
  let tz: string | undefined;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Older engines without a tz database; skip it rather than fail the report.
  }
  return { nav, conn, device, tz, lang: navigator.language, v: ASSET_VERSION };
}

export function reportVital(metric: Metric): void {
  const route = typeof location !== "undefined" ? location.pathname : undefined;

  // Mirror into the dev console + window.__perf() buffer, on the same gate as every
  // other timing (dev, or localStorage.perf). value is ms for the timing metrics; CLS
  // is unitless, so the console number there is nominal.
  record({ label: `vital ${metric.name} (${route ?? "?"})`, totalMs: metric.value });

  if (!sampledIn || !API_BASE_URL || typeof navigator === "undefined" || !navigator.sendBeacon) {
    return;
  }

  // text/plain, not application/json: a CORS-safelisted content type sends without a
  // preflight, which is what makes the beacon survive being fired as the page unloads.
  const payload = JSON.stringify({ ...metric, route, ...context() });
  try {
    navigator.sendBeacon(`${API_BASE_URL}/api/vitals`, new Blob([payload], { type: "text/plain" }));
  } catch {
    // Telemetry is best-effort and must never throw into the app it measures.
  }
}

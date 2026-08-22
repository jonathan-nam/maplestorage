import { beforeEach, describe, expect, it } from "vitest";
import { endpointShape, resetErrorReportsForTest, withinReportCap } from "./report-error";

describe("endpointShape", () => {
  it("keeps a plain endpoint as it is", () => {
    expect(endpointShape("/api/parties")).toBe("/api/parties");
  });

  // A party id in a log line is the one field that would stop this telemetry being anonymous.
  it("drops a uuid out of the path", () => {
    expect(endpointShape("/api/parties/3f2504e0-4f89-11d3-9a0c-0305e82c3301/loot")).toBe(
      "/api/parties/:id/loot",
    );
  });

  it("drops a numeric id", () => {
    expect(endpointShape("/api/characters/42/tokens")).toBe("/api/characters/:id/tokens");
  });

  it("drops a query string", () => {
    expect(endpointShape("/api/bosses/clears?week=2026-08-17")).toBe("/api/bosses/clears");
  });

  // Every reported path has to survive this: a version stamp or a week is not an id.
  it("leaves a non-id segment alone", () => {
    expect(endpointShape("/api/vestige-tranches")).toBe("/api/vestige-tranches");
  });
});

describe("withinReportCap", () => {
  beforeEach(resetErrorReportsForTest);

  // The cap is the point. A page that retries on failure must not turn one broken backend into a
  // log flood, and one Party View load alone sent 45 failing requests.
  it("allows ten reports per page load, then stops", () => {
    const allowed = Array.from({ length: 45 }, () => withinReportCap()).filter(Boolean);

    expect(allowed.length).toBe(10);
  });

  it("starts again on the next page load", () => {
    Array.from({ length: 45 }, withinReportCap);
    resetErrorReportsForTest();

    expect(withinReportCap()).toBe(true);
  });
});

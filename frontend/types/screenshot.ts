// Mirrors backend's screenshots/ScreenshotDtos.kt field-for-field.
export type ScreenshotOutcome =
  | "MATCHED"
  | "MISMATCH"
  | "NEW_CHARACTER_DETECTED"
  | "UNRESOLVABLE"
  | "UNRECOGNIZED_SCREENSHOT"
  | "FAILED";

export type DetectedToken = {
  // The parser's key, e.g. "kalos-token".
  tokenName: string;
  // The human name, e.g. "Kalos's Residual Determination". Resolved server-side
  // from the catalog -- it is NOT derivable from tokenName, and assuming it was
  // is exactly what silently broke token persistence.
  displayName: string;
  iconUrl: string | null;
  quantity: number;
};

export type ScreenshotResult = {
  screenshotId: string;
  outcome: ScreenshotOutcome;
  detectedCharacterName: string | null;
  detectedLevel: number | null;
  pinnedCharacterName: string | null;
  failureReason: string | null;
  // Sent on every outcome, not just the successful one: a screenshot that needs
  // review has still been fully parsed, and showing what we read turns a blank,
  // baffling row into a one-click confirmation.
  tokenCounts: DetectedToken[];
};

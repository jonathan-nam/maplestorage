// Mirrors backend's screenshots/ScreenshotDtos.kt field-for-field.
export type ScreenshotOutcome =
  | "MATCHED"
  | "MISMATCH"
  | "NEW_CHARACTER_DETECTED"
  | "UNRESOLVABLE"
  | "UNRECOGNIZED_SCREENSHOT"
  | "FAILED";

export type ScreenshotResult = {
  screenshotId: string;
  outcome: ScreenshotOutcome;
  detectedCharacterName: string | null;
  detectedLevel: number | null;
  pinnedCharacterName: string | null;
  failureReason: string | null;
};

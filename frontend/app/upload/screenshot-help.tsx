"use client";

import { useState } from "react";

type Os = "mac" | "windows" | "unknown";

const STEPS_BY_OS: Record<Os, string[]> = {
  mac: [
    "Press Cmd + Shift + 4.",
    "Drag a box around the boss-planner or inventory panel — it saves a PNG to your desktop automatically.",
    "Drag that file into the drop zone below (or click the drop zone to browse for it).",
  ],
  windows: [
    "Press Windows key + Shift + S.",
    "Drag a box around the boss-planner or inventory panel — it's copied to your clipboard.",
    "Click anywhere on this page and press Ctrl+V to paste it directly — no need to save a file first.",
  ],
  unknown: [
    "Use your OS's screenshot shortcut (Windows: Win+Shift+S, Mac: Cmd+Shift+4) to capture the boss-planner or inventory panel.",
    "If it's copied to your clipboard, click this page and press Ctrl/Cmd+V to paste it directly.",
    "Otherwise, drag the saved image file into the drop zone below.",
  ],
};

// Best-effort detection, ported from prototypes/web-ui/script.js: User-Agent
// Client Hints where available (Chromium-only), falling back to UA parsing.
// navigator.platform is deliberately not used -- deprecated and increasingly
// unreliable. Either way this is just the default; the toggle below is what
// makes a wrong guess recoverable.
function detectOs(): Os {
  if (typeof navigator === "undefined") return "unknown";
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) {
    if (/mac/i.test(uaData.platform)) return "mac";
    if (/win/i.test(uaData.platform)) return "windows";
    return "unknown";
  }
  const ua = navigator.userAgent || "";
  if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
  if (/Windows NT/i.test(ua)) return "windows";
  return "unknown";
}

export function ScreenshotHelp() {
  const [open, setOpen] = useState(false);
  const [os, setOs] = useState<Os>("unknown");

  return (
    <>
      <p className="intro-copy">
        Drag a screenshot of your inventory into the drop zone — we&apos;ll automatically detect
        which character it&apos;s from and read the item counts. Crop tightly to just the
        inventory window rather than your whole screen — a full game-window screenshot makes the
        item icons too small to read reliably.{" "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (!open) setOs(detectOs());
            setOpen((o) => !o);
          }}
        >
          {open ? "Hide instructions" : "Don't know how to screenshot? Show me how"}
        </a>
        .
      </p>

      {open && (
        <div className="screenshot-help">
          <p className="os-toggle">
            Showing instructions for:{" "}
            {(["windows", "mac"] as const).map((candidate, i) => (
              <span key={candidate}>
                {i > 0 && " | "}
                <a
                  href="#"
                  className={os === candidate ? "active" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    setOs(candidate);
                  }}
                >
                  {candidate === "windows" ? "Windows" : "Mac"}
                </a>
              </span>
            ))}
          </p>
          <ol>
            {STEPS_BY_OS[os].map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}

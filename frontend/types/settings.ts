// Mirrors backend's users/SettingsRoutes.kt SettingsResponse field-for-field.

import type { WorldType } from "@/lib/world";

export type Settings = {
  // Which world the site is answering for. Every account-wide list is narrowed to it server-side,
  // so it is not a preference, it is what the numbers on screen are numbers OF.
  worldType: WorldType;
  // Whether anything in that world can change hands. Follows from worldType, and the server sends
  // it rather than the client deriving it so the rule lives in one place.
  trades: boolean;
  // How many characters the other world holds. What lets a screen say it is narrow rather than
  // empty. See the toggle.
  otherWorldCharacters: number;
};

// PUT /api/settings. Changes which world the site shows. Moves no character: see saveSettings.
export type SaveSettingsBody = {
  worldType: WorldType;
};

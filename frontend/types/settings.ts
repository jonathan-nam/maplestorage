// Mirrors backend's users/SettingsRoutes.kt SettingsResponse field-for-field.

import type { WorldType } from "@/lib/world";

export type Settings = {
  // What a newly added character starts in, and what "all characters" last said. Not an assertion
  // about the account: a character's own world is the truth, and one account can hold both.
  worldType: WorldType;
  // Whether any character is somewhere that trades. Derived by the server from the characters, and
  // the only one of the two an account-wide screen may read.
  trades: boolean;
};

// PUT /api/settings. Sets every character, and the default a new one starts in.
export type SaveSettingsBody = {
  worldType: WorldType;
};

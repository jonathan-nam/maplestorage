// Mirrors backend's users/SettingsRoutes.kt SettingsResponse field-for-field.

import type { WorldType } from "@/lib/world";

export type Settings = {
  worldType: WorldType;
};

export type SaveSettingsBody = {
  worldType: WorldType;
};

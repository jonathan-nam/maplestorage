// Mirrors backend's characters/CharacterDtos.kt CharacterResponse field-for-field.

import type { WorldType } from "@/lib/world";

export type Character = {
  id: string;
  name: string;
  level: number | null;
  jobName: string | null;
  // The world the Nexon lookup found them in ("Scania"), or null when it found nothing and for
  // every character added before detection existed. Evidence, not a setting.
  worldName: string | null;
  // INTERACTIVE or HEROIC. Detected from the world on the way in, falling back to the world being
  // shown when the lookup found nothing.
  worldType: WorldType;
  // Backend-relative, resolve with spriteUrl(). Our own proxy path, not Nexon's URL: they serve
  // sprites with no cache headers, so every page load refetched every one of them.
  spriteImgUrl: string | null;
  spriteRefreshedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

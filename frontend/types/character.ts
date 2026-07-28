// Mirrors backend's characters/CharacterDtos.kt CharacterResponse field-for-field.

import type { WorldType } from "@/lib/world";

export type Character = {
  id: string;
  name: string;
  level: number | null;
  jobName: string | null;
  worldName: string | null;
  // INTERACTIVE or HEROIC. Inherited from the account when the character is added.
  worldType: WorldType;
  spriteImgUrl: string | null;
  spriteRefreshedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

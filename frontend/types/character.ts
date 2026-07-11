// Mirrors backend's characters/CharacterDtos.kt CharacterResponse field-for-field.
export type Character = {
  id: string;
  name: string;
  level: number | null;
  jobName: string | null;
  worldName: string | null;
  spriteImgUrl: string | null;
  spriteRefreshedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

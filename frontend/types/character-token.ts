// Mirrors backend's characters/CharacterDtos.kt CharacterTokenResponse field-for-field.
export type CharacterToken = {
  tokenCatalogId: string;
  name: string;
  iconUrl: string | null;
  quantity: number;
  redeemThreshold: number;
  capturedAt: string;
};

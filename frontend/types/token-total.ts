// Mirrors backend's tokens/TokenRoutes.kt TokenTotalResponse field-for-field.
export type TokenTotal = {
  tokenCatalogId: string;
  name: string;
  iconUrl: string | null;
  quantity: number;
  // Null for a consumable. There is no category flag: an item is redeemable exactly when
  // it has a redemption rule, so a null threshold IS the answer to "is this redeemable?".
  redeemThreshold: number | null;
  // How many characters contributed to `quantity`.
  characterCount: number;
};

// Mirrors backend's tokens/TokenRoutes.kt TokenTotalResponse field-for-field.
export type TokenTotal = {
  tokenCatalogId: string;
  name: string;
  iconUrl: string | null;
  quantity: number;
  redeemThreshold: number;
  // How many characters contributed to `quantity`.
  characterCount: number;
};

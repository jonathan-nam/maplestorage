"use client";

import { useAccountSettings } from "@/lib/use-account-settings";
import { otherWorld, worldLabel } from "@/lib/world";

// The rest of the account, for a screen that is only showing one world of it.
//
// The one thing the world toggle cannot leave unsaid. Every account-wide list is narrowed to the
// world being shown, so an empty Party View, an empty roster and an empty inventory all look exactly
// like an account with nothing in it, and the page then tells you to add what you already have.
// Named per SettingsResponse.otherWorldCharacters, which is where the count comes from.
//
// Nothing at all when the other world is empty, which is most accounts: this is a correction to a
// screen that would otherwise mislead, not a running commentary on where your characters are.

export function OtherWorld() {
  const settings = useAccountSettings();
  // A world nobody has chosen yet has no OTHER world to be the rest of (V74). The server sends 0
  // for it anyway; this is the type saying the same thing, and it stops otherWorld() being handed
  // a null it has no answer for.
  if (!settings?.worldType || settings.otherWorldCharacters === 0) return null;
  return (
    <p className="party-hint">
      {settings.otherWorldCharacters}{" "}
      {settings.otherWorldCharacters === 1 ? "character" : "characters"} in{" "}
      {worldLabel(otherWorld(settings.worldType))}.
    </p>
  );
}

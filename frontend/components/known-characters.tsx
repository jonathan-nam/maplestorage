"use client";

/** The one datalist every character-name box on a page points at. Rendered once per page. */
export const KNOWN_CHARACTERS_ID = "known-characters";

export function KnownCharacters({ names }: { names: string[] }) {
  return (
    <datalist id={KNOWN_CHARACTERS_ID}>
      {names.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  );
}

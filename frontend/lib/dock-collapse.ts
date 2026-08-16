// Whether each upload dock is folded, remembered across visits.
//
// The dropzone sits at the TOP of the page it feeds, which is where you want it on the day you
// upload and in the way on the other six. Folding it has to STICK, or the fold is just a chore
// repeated on every visit.

export type DockName = "inventory" | "planner" | "counts";

/** The dock's title bar, and the only thing on screen when it is folded. */
export const DOCK_LABELS: Record<DockName, string> = {
  inventory: "Inventory screenshot",
  planner: "Maple Planner screenshot",
  counts: "Counts",
};

const PREFIX = "sharpeyes.dock.";

export function dockStorageKey(name: DockName): string {
  return `${PREFIX}${name}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  // Reading the property itself throws when the browser blocks storage, so this is not the same
  // check as `typeof window`.
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Open unless it was explicitly folded.
 *
 * The default is what a first visit sees, and a dock nobody has answered for yet has to be the
 * visible one: it is the only way data gets into the app.
 */
export function readDockOpen(
  name: DockName,
  store: StorageLike | null = browserStorage(),
): boolean {
  try {
    return store?.getItem(dockStorageKey(name)) !== "closed";
  } catch {
    return true;
  }
}

export function writeDockOpen(
  name: DockName,
  open: boolean,
  store: StorageLike | null = browserStorage(),
): void {
  try {
    store?.setItem(dockStorageKey(name), open ? "open" : "closed");
  } catch {
    // A preference that cannot be saved is not worth failing the click over.
  }
}

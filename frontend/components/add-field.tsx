import type { ReactNode } from "react";

/**
 * A box with its name over it, in a row of them. The shape Add Party, Add Drop and the Sale
 * Ledger's forms share.
 *
 * `on` is false where the same form is also drawn somewhere that labels nothing, which returns the
 * bare control: DropPicker and LootSaleForm are each carried by screens outside the one being
 * labelled, and those keep the row they had.
 *
 * At module scope on purpose. Declared inside a component this would be a new component type on
 * every render, so React would remount the box instead of updating it and typing would lose the
 * caret mid-word.
 */
export function Field({
  on,
  label,
  cls,
  children,
}: {
  /**
   * Required, and NOT defaulted. An optional `on = true` reads as the obvious shape and is a trap:
   * a caller passing `on={card}` for a `card?: boolean` it was never given passes `undefined`,
   * which takes the default and labels the screens that asked for no labels. That is exactly what
   * happened, on the pool row and on three of DropPicker's four.
   */
  on: boolean;
  label: string;
  /** How wide the box wants to be. See .add-field's modifiers in globals.css. */
  cls?: string;
  children: ReactNode;
}) {
  if (!on) return <>{children}</>;
  return (
    <label className={cls ? `add-field ${cls}` : "add-field"}>
      <span>{label}</span>
      {children}
    </label>
  );
}

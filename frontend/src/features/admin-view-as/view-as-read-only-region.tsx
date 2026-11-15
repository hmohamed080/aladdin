import type { ReactNode } from "react";

/**
 * The page content of the exact view. A native disabled `<fieldset>` makes the browser disable every nested button, input,
 * select and textarea while links and navigation keep working. This is a UI nicety ONLY: the server refuses every write
 * regardless (edge gate, server-action / client boundary, STABLE database readers). `contents` keeps the layout identical.
 */
export function ViewAsReadOnlyRegion({ children }: { children: ReactNode }) {
  return (
    <fieldset
      disabled
      data-view-as-read-only
      className="contents [&_:disabled]:cursor-not-allowed [&_button:disabled]:opacity-60 [&_input:disabled]:opacity-60"
    >
      {children}
    </fieldset>
  );
}

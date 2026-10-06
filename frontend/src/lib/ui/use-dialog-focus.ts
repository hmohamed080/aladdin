"use client";

import { useEffect, useRef } from "react";

/**
 * Focus management for a modal dialog: focuses the first control, traps Tab,
 * closes on Escape and returns focus to what opened it.
 */
export function useDialogFocus(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(
      'button, input, select, [href], [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => !element.hasAttribute("disabled"));
    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return ref;
}

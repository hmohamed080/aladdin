"use client";

import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { FloatingMenu } from "@/components/ui/floating-menu";
import { fieldBase } from "@/components/ui/field-style";
import { cn } from "@/lib/ui/cn";

/** The tallest a listbox grows (px) before it scrolls inside: ~7 rows, the same for every select, whatever its length. */
export const LISTBOX_MAX_HEIGHT = 256;

export type ListboxOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Options sharing a `group` (adjacent, in order) are listed under that heading, as `<optgroup>` would. */
  group?: string;
};

/**
 * THE SHARED SINGLE-CHOICE SELECT for every control we own.
 *
 * A browser's native <select> picker cannot be styled consistently: Chromium 135+ can be reached with
 * `appearance: base-select`, Firefox and Safari keep their own un-themed, non-rounded popups, and none of them can
 * be told to flip, stay inside a scroll container, or follow the product's design tokens. So the controls WE own use
 * this instead: a real `<button>` (so it is a form control with a visible label and focus ring) that opens a
 * `listbox` on the shared floating surface (portal + Floating UI), with full keyboard support — Enter / Space / Arrow
 * Down open it, Arrow Up / Down / Home / End move, type-ahead jumps, Enter chooses, Escape closes and returns focus.
 *
 * It is controlled (`value` / `onChange`), and when `name` is given it also writes a hidden input, so it drops into
 * a plain <form> and a Server Action exactly like the <select> it replaces. (`Select` in controls.tsx is the
 * drop-in for markup written as `<select><option/></select>`; it builds on this and keeps a real native <select> as
 * the form-value carrier.)
 *
 * Native browser date / time pickers stay native; this is only for choosing from a list.
 */
export function ListboxSelect({
  label,
  labelledBy,
  hiddenLabel,
  value,
  options,
  onChange,
  name,
  id,
  disabled = false,
  placeholder,
  className,
  buttonClassName,
  invalid = false,
  describedBy,
  variant = "default",
  emptyIsPlaceholder = false,
  buttonRef,
  children,
}: {
  /** The accessible name of the control (and of its list). Optional when `labelledBy` or an external <label> names it. */
  label?: string;
  labelledBy?: string;
  /**
   * Names the control with visually hidden TEXT inside the button ("City: Giza") instead of an aria-label, the way a
   * native select announces its label and value. A wrapper whose <label for> already points at a hidden form control
   * uses this so the label resolves to exactly ONE element for assistive tech, tests and automation alike.
   */
  hiddenLabel?: string;
  value: string;
  options: readonly ListboxOption[];
  onChange: (value: string) => void;
  /** Writes a hidden input of this name, so it submits with a form. */
  name?: string;
  id?: string;
  disabled?: boolean;
  /** Shown while no option has the current value. */
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  invalid?: boolean;
  describedBy?: string;
  /** `default` is the filter/toolbar look; `field` matches Input exactly; `compact` is `field` at toolbar height. */
  variant?: "default" | "field" | "compact";
  /** An option whose value is "" is a prompt ("Choose…"), so it reads as muted text, like a placeholder. */
  emptyIsPlaceholder?: boolean;
  /** Lets a wrapper reach the trigger (to forward focus to it). */
  buttonRef?: RefObject<HTMLButtonElement | null>;
  /** Rendered inside the control's box, after the trigger (a wrapper's hidden form carrier). */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ownTrigger = useRef<HTMLButtonElement>(null);
  const trigger = buttonRef ?? ownTrigger;
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const compact = variant === "compact";

  // Opening puts focus on the chosen option (or the first one), so the keyboard continues from where the value is.
  useEffect(() => {
    if (!open) return;
    const list = document.getElementById(listId);
    // The chosen option — unless it is DISABLED (a "Choose…" prompt is selected until a real choice is made, and a
    // disabled button cannot take focus), in which case the first enabled one, so the keyboard always lands in the list.
    const target =
      list?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]:not([disabled])') ?? list?.querySelector<HTMLElement>('[role="option"]:not([disabled])');
    target?.focus();
  }, [open, listId]);

  // Adjacent options with the same `group` are listed together under one heading.
  const sections: Array<{ group?: string; items: ListboxOption[] }> = [];
  for (const option of options) {
    const last = sections[sections.length - 1];
    if (last && last.group === option.group) last.items.push(option);
    else sections.push({ group: option.group, items: [option] });
  }

  const optionButton = (option: ListboxOption) => (
    <button
      key={option.value}
      type="button"
      role="option"
      aria-selected={option.value === value}
      disabled={option.disabled}
      onClick={() => {
        onChange(option.value);
        setOpen(false);
        trigger.current?.focus();
      }}
      className={cn(
        "flex min-h-9 w-full items-center rounded-sm px-sm text-start text-label text-fg transition-colors",
        "hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        "disabled:cursor-not-allowed disabled:opacity-50",
        option.value === value && "bg-info/10 font-semibold text-info",
      )}
    >
      {option.label}
    </button>
  );

  const triggerBase =
    variant === "default"
      ? "flex min-h-10 w-full min-w-0 items-center justify-between gap-sm rounded-sm border border-strong bg-surface px-sm text-start text-body text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface"
      : cn(fieldBase, "flex min-w-0 items-center justify-between gap-sm text-start data-[invalid=true]:border-danger data-[invalid=true]:focus-visible:ring-danger/30");

  return (
    <div className={cn("relative min-w-0", className)}>
      <button
        ref={trigger}
        id={id}
        type="button"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-describedby={describedBy}
        data-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(triggerBase, variant === "default" && invalid && "border-danger", buttonClassName)}
      >
        {hiddenLabel ? <span className="sr-only">{hiddenLabel}: </span> : null}
        <span className={cn("min-w-0 truncate", (!selected || (emptyIsPlaceholder && selected.value === "")) && "text-fg-muted")}>
          {selected?.label ?? placeholder ?? ""}
        </span>
        <ChevronDownIcon size={compact ? 14 : 15} aria-hidden="true" className={cn("shrink-0 text-fg-muted transition-transform", open && "rotate-180")} />
      </button>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {children}

      <FloatingMenu
        id={listId}
        open={open && !disabled}
        onClose={() => setOpen(false)}
        anchorRef={trigger}
        role="listbox"
        aria-label={label ?? hiddenLabel}
        aria-labelledby={label || hiddenLabel ? undefined : labelledBy}
        placement="bottom-start"
        matchAnchorWidth
        maxHeight={LISTBOX_MAX_HEIGHT}
        className="p-xs"
      >
        {sections.map((section, index) =>
          section.group ? (
            <div key={`${section.group}:${index}`} role="group" aria-label={section.group}>
              <div role="presentation" className="px-sm pb-1 pt-sm text-caption font-semibold text-fg-muted">
                {section.group}
              </div>
              {section.items.map(optionButton)}
            </div>
          ) : (
            <Fragment key={`ungrouped:${index}`}>{section.items.map(optionButton)}</Fragment>
          ),
        )}
      </FloatingMenu>
    </div>
  );
}

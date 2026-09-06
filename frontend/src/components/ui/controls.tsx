"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/ui/cn";

/**
 * Shared form controls (one canonical set — do not fork). Buttons and fields
 * share a consistent radius, spacing, focus ring, and disabled/loading policy so
 * the whole app reads as one system. Tokens only; no raw hex.
 */
const variants = {
  primary: "bg-primary text-primary-foreground shadow-sm hover:opacity-90 active:opacity-100",
  accent: "bg-accent-solid text-on-accent shadow-sm hover:brightness-105 active:brightness-100",
  outline: "border border-strong bg-transparent text-fg hover:bg-surface-2",
  ghost: "bg-transparent text-fg-secondary hover:bg-surface-2 hover:text-fg",
  danger: "border border-danger/50 bg-transparent text-danger hover:bg-danger/10",
} as const;

const sizes = {
  sm: "min-h-8 gap-1.5 px-3 py-1 text-label",
  md: "min-h-10 gap-2 px-md py-2 text-label",
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

/**
 * The shared geometry every button-shaped control uses, extracted so a LINK can
 * wear it without a second implementation.
 */
function controlClass(variant: keyof typeof variants, size: keyof typeof sizes, className?: string) {
  return cn(
    "inline-flex select-none items-center justify-center rounded-sm font-medium transition-[background-color,color,opacity,filter,box-shadow] duration-fast",
    focusRing,
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
    sizes[size],
    variants[variant],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={controlClass(variant, size, className)}
      {...rest}
    >
      {children}
    </button>
  );
});

/**
 * A LINK that wears the button geometry.
 *
 * Added to the canonical set rather than written per page (R3/R6). Until the
 * Jobs module there was no primary "go and do this" destination in the
 * workspace — every navigational affordance was an accent text link — so
 * `Button` only ever needed to render a `<button>`. "Post a job" and "View
 * applications" are genuinely navigation, and a `<button onClick={router.push}>`
 * would take a real anchor away from the reader: no middle-click, no open in a
 * new tab, no href in the status bar, and a control announced as a button when
 * it is a link.
 *
 * Identical geometry by construction — it shares `controlClass` with `Button`,
 * so the two cannot drift.
 */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href={href} className={controlClass(variant, size, className)}>
      {children}
    </a>
  );
}

/** Submit button that reflects the enclosing form's pending state. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
  disabled = false,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  className?: string;
  /** Extra gate (e.g. required consent) ORed with the form's pending state. */
  disabled?: boolean;
  /**
   * REQUIRED when `children` is an icon rather than words. A submit control whose
   * only content is a glyph announces itself as "button" and nothing else, so the
   * prop exists here rather than in each caller — the Portfolio reorder controls
   * were the first to need it, and the next icon-only submit should not have to
   * rediscover that a local replacement is the wrong answer (R6).
   */
  "aria-label"?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending || disabled}
      aria-busy={pending}
      aria-label={ariaLabel}
      className={className}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/** Accessible checkbox + label row used for consent and other opt-ins. */
export function Checkbox({
  id,
  name,
  checked,
  onChange,
  children,
}: {
  id: string;
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-body text-fg">
      <input
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4.5 w-4.5 shrink-0 rounded-xs border border-strong text-accent-solid accent-[var(--accent-solid)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/50"
      />
      <span>{children}</span>
    </label>
  );
}

/** Small inline spinner for pending buttons (honours reduced motion via CSS). */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

const fieldBase =
  "w-full rounded-md border border-strong bg-canvas px-3.5 py-2.5 text-body-lg text-fg placeholder:text-fg-muted " +
  "transition-[border-color,box-shadow] duration-fast " +
  "focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-0 " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/30";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(fieldBase, "min-h-11", className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, "min-h-24 leading-relaxed", className)} {...rest} />;
  },
);

/**
 * A select is a FORM FIELD by default and a piece of CHROME when it sits in a
 * header or a toolbar, and those two want different proportions. The compact
 * size existed already — as four geometry utilities hand-patched onto the branch
 * switcher at the call site, which is how the next compact select would have
 * ended up a different height from the first one.
 *
 * `field` matches Input and Textarea exactly, so a select in a form still lines
 * up with the text inputs beside it.
 */
const selectSize = {
  field: "min-h-11 pe-9",
  compact: "h-7 min-h-0 py-0 px-2.5 pe-8 text-label",
} as const;

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  /**
   * `size` shadows the native attribute, which is why that one is omitted above.
   * On a select, native `size` means "show N rows as a list box" — it turns the
   * control into something that is no longer a dropdown at all, so nothing here
   * can want it, and `size` is the name every other control in this file uses
   * for its proportions.
   */
  size?: keyof typeof selectSize;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, size = "field", ...rest },
  ref,
) {
  const compact = size === "compact";
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(fieldBase, "appearance-none", selectSize[size], className)}
        {...rest}
      >
        {children}
      </select>
      {/* The chevron tracks the field's own inset so it never floats at a
          different distance from the edge than the text does. `end-*` and not
          `right-*`: in Arabic the glyph belongs on the left. */}
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 flex items-center text-fg-muted",
          compact ? "end-2" : "end-3",
        )}
        aria-hidden="true"
      >
        <svg width={compact ? 14 : 16} height={compact ? 14 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
    </div>
  );
});

/** Accessible labelled field wrapper with optional error/hint text. */
export function LabeledField({
  label,
  htmlFor,
  error,
  hint,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  optional?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-label font-medium text-fg-secondary">
        {label}
        {optional ? <span className="font-normal text-fg-muted"> ({optional})</span> : null}
      </label>
      {children}
      {hint ? <p className="text-label text-fg-muted">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

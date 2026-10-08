"use client";

import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { useFormStatus } from "react-dom";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { fieldBase } from "@/components/ui/field-style";
import { ListboxSelect, type ListboxOption } from "@/components/ui/listbox";

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

/**
 * Resend control shared by every OTP screen: disabled during the cooldown,
 * showing the remaining seconds, and separately reflecting its own request
 * actually in flight (`useFormStatus`, since it submits its own sibling form)
 * rather than only ever showing the cooldown countdown. One canonical
 * implementation (was previously forked inside the Sign In / Sign Up flow) so
 * Sign In, Sign Up, Recovery, and the standalone `/auth/verify` screen all
 * resend identically.
 */
export function ResendButton({ cooldown }: { cooldown: number }) {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  const waiting = cooldown > 0;
  return (
    <Button type="submit" variant="ghost" size="sm" disabled={waiting || pending} aria-busy={pending}>
      {pending ? (
        <>
          <Spinner />
          {t("auth.sending")}
        </>
      ) : waiting ? (
        t("auth.resendIn", { seconds: cooldown })
      ) : (
        t("auth.resend")
      )}
    </Button>
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
  field: "min-h-11",
  compact: "h-7 min-h-0 py-0 px-2.5 text-label",
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

/** The text of an <option>'s children (strings / numbers / arrays of them), as a native option would show it. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/** Reads `<option>` / `<optgroup>` children (through fragments and arrays) into the listbox's option list. */
function collectOptions(nodes: ReactNode, group?: string, out: ListboxOption[] = []): ListboxOption[] {
  Children.forEach(nodes, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<{ value?: string | number; disabled?: boolean; label?: string; children?: ReactNode }>;
    if (element.type === Fragment) collectOptions(element.props.children, group, out);
    else if (element.type === "optgroup") collectOptions(element.props.children, element.props.label, out);
    else if (element.type === "option") {
      const label = textOf(element.props.children);
      out.push({ value: element.props.value !== undefined ? String(element.props.value) : label, label, disabled: Boolean(element.props.disabled), group });
    }
  });
  return out;
}

/**
 * THE SHARED SELECT — a drop-in for `<select>` written as `<Select><option/></Select>`, drawn in the design system.
 *
 * WHY NOT A NATIVE PICKER. A browser's own option list cannot follow the product: Firefox and Safari cannot round or
 * theme it, none can flip, stay inside a scroll container or follow the design tokens, and Chromium only themes it
 * behind a feature flag. So what the person sees and operates is the shared `ListboxSelect` (a button that opens a
 * `listbox` on the portaled FloatingMenu: rounded surface, collision handling, RTL, light/dark, Arrow / Home / End /
 * type-ahead, Escape, proper roles).
 *
 * WHY A REAL <select> STILL EXISTS. Every one of this component's call sites is a plain form field (Server Actions,
 * FormData, `required`, `defaultValue`, `ref`, `onChange(event)`, `form` reset). So a REAL native `<select>` stays in
 * the tree as the form-value carrier: it owns `name`, `id`, `value` / `defaultValue`, `required`, `disabled`, the ref
 * and the change event, and the list drives it — choosing an option sets its value and dispatches a genuine `change`
 * event, which React delivers to the caller's `onChange` exactly as the native control would. It is visually hidden
 * (not `display:none`, so a `required` field still validates and can be focused), aria-hidden (the button is the one
 * accessible control), and focus sent to it (a label click, a failed validation) is forwarded to the button.
 *
 * The native select stays THE labelled control — `<label htmlFor>`, `aria-label`, getByLabel and automation resolve to
 * it exactly once, unchanged. The visible button repeats that name as visually hidden text ("City: Giza"), the way a
 * native select announces its label and value, so there is one control for assistive tech and no duplicate label.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, size = "field", onChange, onFocus, id, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid, ...rest },
  ref,
) {
  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const options = useMemo(() => collectOptions(children), [children]);
  const controlled = rest.value !== undefined;
  const [local, setLocal] = useState(() => String(rest.defaultValue ?? options.find((o) => !o.disabled)?.value ?? ""));
  const [labelText, setLabelText] = useState<string | undefined>(undefined);

  const setRefs = useCallback(
    (node: HTMLSelectElement | null) => {
      nativeRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // The browser decides what an uncontrolled select shows when its options change or its form resets; follow it.
  useLayoutEffect(() => {
    if (controlled) return;
    const value = nativeRef.current?.value;
    if (value !== undefined && value !== local) setLocal(value);
  }, [controlled, local, children]);
  useEffect(() => {
    const form = nativeRef.current?.form;
    if (!form || controlled) return;
    const onReset = () => setTimeout(() => setLocal(nativeRef.current?.value ?? ""), 0);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [controlled]);

  // The field's name, as TEXT: an explicit aria-label, else the elements aria-labelledby points at, else the <label for>
  // that points at the native select. The native select stays THE labelled control (so `<label for>`, getByLabel and
  // automation resolve to it exactly once); the visible button repeats that name as hidden text inside itself.
  useLayoutEffect(() => {
    const native = nativeRef.current;
    if (!native) return;
    let text = ariaLabel?.trim() ?? "";
    if (!text && ariaLabelledBy) {
      text = ariaLabelledBy
        .split(/\s+/)
        .map((labelId) => document.getElementById(labelId)?.textContent?.trim() ?? "")
        .join(" ")
        .trim();
    }
    if (!text) {
      text = Array.from(native.labels ?? [])
        .map((label) => label.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
    }
    setLabelText(text || undefined);
  }, [ariaLabel, ariaLabelledBy, id, children]);

  const current = controlled ? String(rest.value ?? "") : local;

  return (
    <ListboxSelect
      variant={size === "compact" ? "compact" : "field"}
      hiddenLabel={labelText}
      describedBy={ariaDescribedBy}
      invalid={ariaInvalid === true || ariaInvalid === "true"}
      disabled={rest.disabled}
      value={current}
      options={options}
      emptyIsPlaceholder
      buttonRef={buttonRef}
      buttonClassName={cn(selectSize[size], className)}
      onChange={(value) => {
        const native = nativeRef.current;
        if (!native) return;
        native.value = value;
        native.dispatchEvent(new Event("change", { bubbles: true }));
      }}
    >
      <select
        {...rest}
        ref={setRefs}
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-invalid={ariaInvalid}
        // `data-ui-select-native` marks the form-value carrier: hidden, not focusable by Tab, sized to the control so a
        // browser validation bubble and a test runner both find it where the person sees the field.
        data-ui-select-native=""
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        onChange={(event) => {
          setLocal(event.target.value);
          onChange?.(event);
        }}
        onFocus={(event) => {
          buttonRef.current?.focus();
          onFocus?.(event);
        }}
      >
        {children}
      </select>
    </ListboxSelect>
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

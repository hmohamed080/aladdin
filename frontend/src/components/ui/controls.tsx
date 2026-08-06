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
  accent: "bg-accent-solid text-brand-basalt shadow-sm hover:brightness-105 active:brightness-100",
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

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-sm font-medium transition-[background-color,color,opacity,filter,box-shadow] duration-fast",
        focusRing,
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
        sizes[size],
        variants[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/** Submit button that reflects the enclosing form's pending state. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending} className={className}>
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

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select ref={ref} className={cn(fieldBase, "min-h-11 appearance-none pe-9", className)} {...rest}>
          {children}
        </select>
        <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-fg-muted" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </div>
    );
  },
);

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

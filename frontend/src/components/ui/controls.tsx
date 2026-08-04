"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/ui/cn";

const variants = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  accent: "bg-accent-solid text-brand-basalt hover:opacity-90",
  outline: "border border-strong bg-transparent text-fg hover:bg-surface-2",
  ghost: "bg-transparent text-fg-secondary hover:bg-surface-2 hover:text-fg",
  danger: "border border-danger/50 bg-transparent text-danger hover:bg-danger/10",
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-sm px-md py-1.5 text-label font-medium transition-colors duration-fast",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        "disabled:cursor-not-allowed disabled:opacity-50",
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
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: keyof typeof variants;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending} className={className}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

const fieldBase =
  "w-full rounded-sm border bg-canvas px-3 py-2 text-body-lg text-fg placeholder:text-fg-muted " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-canvas " +
  "disabled:opacity-50 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(fieldBase, className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, "min-h-20", className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn(fieldBase, "appearance-none", className)} {...rest}>
        {children}
      </select>
    );
  },
);

/** Accessible labelled field wrapper with optional error text. */
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
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-label text-fg-secondary">
        {label}
        {optional ? <span className="text-fg-muted"> ({optional})</span> : null}
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

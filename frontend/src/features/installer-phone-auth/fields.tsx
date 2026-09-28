"use client";

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { EyeIcon, EyeOffIcon, LockIcon } from "./icons";

/**
 * The approved field: label and value stacked INSIDE one bordered box, the
 * field's icon at the inline end. Tokens only; the whole box shows focus and
 * the error state, and the error text is linked through `aria-describedby`.
 */
type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "name"> & {
  id: string;
  name: string;
  label: string;
  icon: ReactNode;
  error?: ReactNode;
  hint?: string;
  /** Rendered between the input and the icon (the password visibility toggle). */
  trailing?: ReactNode;
};

export function IconField({ id, name, label, icon, error, hint, trailing, className, ...input }: FieldProps) {
  // An error replaces the hint rather than stacking under it (the too-short
  // error and the policy hint are the same sentence).
  const showHint = Boolean(hint) && !error;
  const describedBy = [error ? `${id}-error` : null, showHint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "flex min-h-16 items-center gap-sm rounded-lg border bg-surface px-md py-2.5 tablet:min-h-[4.5rem] tablet:py-3 transition-[border-color,box-shadow] duration-fast focus-within:ring-2",
          error
            ? "border-danger focus-within:border-danger focus-within:ring-danger/30"
            : "border-strong focus-within:border-accent focus-within:ring-focus/40",
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <label htmlFor={id} className="text-body font-medium text-fg">
            {label}
          </label>
          <input
            id={id}
            name={name}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(
              "w-full min-w-0 bg-transparent text-body-lg text-fg placeholder:text-fg-muted focus-visible:outline-none",
              className,
            )}
            {...input}
          />
        </div>
        {trailing}
        <span className="shrink-0 text-fg-muted">{icon}</span>
      </div>
      {showHint ? (
        <p id={`${id}-hint`} className="text-label text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <div id={`${id}-error`} role="alert" className="text-label text-danger">
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** Password variant with an accessible show/hide toggle (a real button, never submits). */
export function PasswordField(props: Omit<FieldProps, "icon" | "trailing" | "type">) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <IconField
      {...props}
      type={visible ? "text" : "password"}
      dir="ltr"
      className="text-end"
      icon={<LockIcon />}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? t("authPasswordPreview.hidePassword") : t("authPasswordPreview.showPassword")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xs text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      }
    />
  );
}

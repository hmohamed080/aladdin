"use client";

import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";

const fieldBase =
  "w-full rounded-md border border-strong bg-canvas px-3.5 py-2.5 text-body-lg text-fg placeholder:text-fg-muted " +
  "transition-[border-color,box-shadow] duration-fast " +
  "focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-0 " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/30";

/**
 * A password field with an accessible, keyboard-operable show/hide toggle.
 * The toggle is a real `type="button"` (never submits the form), carries an
 * `aria-label` + `aria-pressed` that flips with the state (screen readers
 * hear "Show password" / "Hide password", not a static icon description),
 * and the field itself keeps whatever `autoComplete` the caller passes
 * (`new-password` for registration/reset, `current-password` for sign-in —
 * never guessed here, since only the caller knows which).
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function PasswordInput({ className, onChange, ...rest }, ref) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? "text" : "password"}
        onChange={onChange}
        className={cn(fieldBase, "min-h-11 pe-11", className)}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? t("authPasswordPreview.hidePassword") : t("authPasswordPreview.showPassword")}
        className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 rounded-sm"
      >
        {visible ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.6 18.6 0 0 1 4.22-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 10 8 10 8a18.6 18.6 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <path d="M1 1l22 22" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
});

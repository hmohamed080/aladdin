"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ChangeEvent } from "react";
import { useFormStatus } from "react-dom";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";

/**
 * The one canonical OTP entry control — every screen that collects a 6-digit
 * email code (Sign In, Sign Up, standalone `/auth/verify`) renders through
 * this, never a local re-implementation. A segmented box per digit: numeric
 * input, auto-advance, backspace-to-previous, arrow-key navigation, and a
 * full-code paste distributed across every box in one action. A single hidden
 * input carries the combined value under `name`, so it drops into the existing
 * FormData-based server actions unchanged — no caller-side parsing needed.
 *
 * `length` defaults to 6, matching the `otpSchema` regex in
 * `server/actions/auth.ts` (`/^\d{6}$/`) — the two must be changed together.
 *
 * Digits are always LTR (`dir="ltr"` on the group), even inside an Arabic RTL
 * page: a code reads left-to-right regardless of script direction, the same
 * rule already applied to email/phone fields elsewhere in onboarding.
 *
 * Disables automatically while its enclosing `<form>` is submitting
 * (`useFormStatus`), so callers don't need to thread a separate pending flag.
 */
export function OtpInput({
  name,
  length = 6,
  id,
  error = false,
  disabled = false,
  autoFocus = false,
  onComplete,
}: {
  name: string;
  length?: number;
  id?: string;
  error?: boolean;
  disabled?: boolean;
  /** Focus the first box on mount — appropriate once a code has just been sent, not when the field is one of several on an already-populated form. */
  autoFocus?: boolean;
  /** Fires once every box holds a digit — e.g. to trigger auto-submit. */
  onComplete?: (code: string) => void;
}) {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (autoFocus) inputRefs.current[0]?.focus();
    // Mount-only: this fires once when the field first appears (e.g. right
    // after a code is sent), not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const code = digits.join("");

  const commit = (next: string[]) => {
    setDigits(next);
    if (next.every((d) => d.length === 1)) onComplete?.(next.join(""));
  };

  const handleChange = (index: number) => (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    if (!raw) {
      commit(digits.map((d, i) => (i === index ? "" : d)));
      return;
    }
    // Typing over an already-filled box (selection replaced) — keep the last
    // character so re-typing behaves naturally instead of concatenating.
    const value = raw.slice(-1);
    commit(digits.map((d, i) => (i === index ? value : d)));
    if (index < length - 1) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (digits[index]) {
        commit(digits.map((d, i) => (i === index ? "" : d)));
      } else if (index > 0) {
        e.preventDefault();
        inputRefs.current[index - 1]?.focus();
        commit(digits.map((d, i) => (i === index - 1 ? "" : d)));
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const raw = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!raw) return;
    e.preventDefault();
    const next = Array(length).fill("");
    for (let i = 0; i < Math.min(raw.length, length); i++) next[i] = raw[i];
    commit(next);
    const lastFilled = Math.min(raw.length, length) - 1;
    inputRefs.current[Math.max(lastFilled, 0)]?.focus();
  };

  return (
    <div dir="ltr" className="flex flex-col gap-1.5">
      {/* No group-level aria-label: this always sits inside a `LabeledField`
          whose external <label> already names box 0 ("One-time code") — giving
          the group the SAME text as a second aria-label would make two
          elements match that label text, breaking `getByLabelText`-style
          lookups (and confusing screen readers with a duplicate announcement). */}
      <div role="group" className="flex gap-2">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => {
              inputRefs.current[index] = el;
            }}
            id={index === 0 ? id : undefined}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={1}
            value={digit}
            disabled={isDisabled}
            aria-invalid={error || undefined}
            // Box 0 keeps its accessible name from the external <label htmlFor>
            // (LabeledField, e.g. "One-time code") — an aria-label here would
            // silently override that association. The remaining boxes have no
            // such label, so they get their own positional name.
            aria-label={index === 0 ? undefined : t("auth.codeDigitLabel", { position: index + 1, total: length })}
            onChange={handleChange(index)}
            onKeyDown={handleKeyDown(index)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            className={cn(
              "h-12 w-10 rounded-md border border-strong bg-canvas text-center text-title font-mono text-fg",
              "transition-[border-color,box-shadow] duration-fast",
              "focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-focus/40",
              "disabled:cursor-not-allowed disabled:opacity-60",
              error && "border-danger focus-visible:ring-danger/30",
            )}
          />
        ))}
      </div>
      <input type="hidden" name={name} value={code} />
    </div>
  );
}

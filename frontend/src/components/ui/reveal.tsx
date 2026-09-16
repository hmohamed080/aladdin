"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";

/**
 * The one scroll/entry-reveal primitive for the Landing page — componentized
 * so every section chooses a direction/delay instead of hand-writing its own
 * `motion.div` (see AGENTS.md guidance against one-off inline animation code).
 * Calm on purpose: opacity + a small translate + a light scale, the same
 * `--ease-out-expo` curve already in `tailwind.config.ts`, never a spring or
 * bounce. `viewport={{ once: true }}` — a revealed section stays revealed,
 * it does not replay on every scroll pass.
 */
export function Reveal({
  children,
  direction = "up",
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** "up" for a small vertical settle; "start"/"end" for a logical (RTL-aware) horizontal entry. */
  direction?: "up" | "start" | "end";
  /** Stagger offset in seconds. */
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const { dir } = useI18n();
  // "start"/"end" are LOGICAL — the physical sign flips under RTL so the
  // panel still enters from the reading-start edge in Arabic, not always
  // from the physical left (motion's `x` only understands physical pixels).
  const startSign = dir === "rtl" ? 1 : -1;
  const hidden =
    direction === "up"
      ? { opacity: 0, y: 18 }
      : direction === "start"
        ? { opacity: 0, x: 28 * startSign, scale: 0.97 }
        : { opacity: 0, x: -28 * startSign, scale: 0.97 };

  return (
    <motion.div
      className={className}
      initial={reduced ? false : hidden}
      whileInView={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: reduced ? 0 : 0.6, delay: reduced ? 0 : delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

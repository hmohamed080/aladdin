"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { ErrorRecovery, type RecoverableError } from "@/components/error/error-recovery";

/**
 * Root route-level error boundary. It sits ABOVE every segment, so it catches what a segment's own `error.tsx` cannot -
 * most importantly an exception thrown by a segment LAYOUT such as `app/home/layout.tsx` (a boundary only catches errors
 * from its children, never from the layout beside it). `app/b2b/error.tsx` still handles B2B pages first.
 *
 * Retry re-asks the SERVER (`router.refresh()`) and then resets the boundary; `reset()` alone would only re-render the
 * client tree and show the same server failure again. The session cookie is untouched either way.
 */
export default function AppError({ error, reset }: { error: RecoverableError; reset: () => void }) {
  const router = useRouter();
  return (
    <ErrorRecovery
      error={error}
      scope="app"
      onRetry={() =>
        startTransition(() => {
          router.refresh();
          reset();
        })
      }
    />
  );
}

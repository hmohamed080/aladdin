"use client";

import { useEffect } from "react";
import { BRAND_2026_SCOPE_CLASS } from "@/lib/brand/surface";

/**
 * Keeps the 2026 palette scope on `<body>` while the workspace is mounted.
 *
 * On a HARD load the root layout already rendered the class onto <body> (the
 * middleware flags the route), so the first frame is right and this is a no-op.
 * It exists for CLIENT navigation: the root layout does not re-render when the
 * reader moves between /home and /b2b, so this adds the class on the way in and
 * removes it on the way out — content portaled to <body> (command palette,
 * menus, sheets) then always matches the page it opened over.
 */
export function Brand2026BodyScope() {
  useEffect(() => {
    const body = document.body;
    body.classList.add(BRAND_2026_SCOPE_CLASS);
    return () => body.classList.remove(BRAND_2026_SCOPE_CLASS);
  }, []);
  return null;
}

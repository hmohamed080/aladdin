import type { ReactNode } from "react";
import { PreviewShell } from "@/features/admin-preview/preview-shell";

export const dynamic = "force-dynamic";

/**
 * Phase 0 — Admin Frontend Blueprint / Preview.
 *
 * Deliberately has NO auth check of its own: nesting under `app/admin/layout.tsx`
 * means every route under `/admin/preview/**` already inherits that layout's
 * `loadPlatformRole()` gate (platform staff only, else redirect to `/`) before
 * this component ever renders. A second, bespoke check here would be a second
 * place to get the boundary wrong — the existing Admin gate is the one and only
 * enforcement point, exactly as the real Admin console already relies on it.
 */
export default function AdminPreviewLayout({ children }: { children: ReactNode }) {
  return <PreviewShell>{children}</PreviewShell>;
}

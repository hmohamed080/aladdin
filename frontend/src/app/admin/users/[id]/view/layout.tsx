import type { ReactNode } from "react";
import { requireViewAs } from "@/server/view-as/guard";
import { ViewAsBanner } from "@/features/admin-view-as/view-as-banner";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Read-only "view as account" shell. Establishes the audited session and draws the persistent banner. This layout is
 * NOT the security boundary on its own (layouts are not re-run on soft navigation): every page below calls
 * `requireViewAs` itself, and a test enforces that. Nothing under this tree may import a server action or an editor —
 * see `view-as-read-only.test.ts`.
 */
export default async function ViewAsLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireViewAs(id);
  return (
    <div className="flex flex-col gap-lg">
      <ViewAsBanner
        subjectUserId={session.subjectUserId}
        subjectName={session.subjectName}
        kind={session.kind}
        expiresAt={session.expiresAt}
      />
      {children}
    </div>
  );
}

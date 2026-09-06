import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { ClipboardIcon } from "@/components/ui/icons";
import type { TranslateFn } from "@/lib/i18n/translate";

/**
 * The Work module on the Account Overview (Increment 14 — the redesign the
 * Reviews/Network module comments explicitly deferred to).
 *
 * Same shape as its siblings — icon, title, one line, a real number, one
 * action. The number is completed assignments, the one figure `/home/work`
 * itself would call unambiguous: a job that is still open, applied to, or in
 * progress is not yet a fact about the professional's record the way a
 * completed one is.
 */
export function WorkModule({
  completedCount,
  t,
}: {
  completedCount: number;
  t: TranslateFn;
}) {
  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-center gap-2">
        <ClipboardIcon size={18} className="shrink-0 text-fg-secondary" />
        <h3 className="text-title text-fg">{t("profile.myWork.title")}</h3>
      </div>
      <p className="text-label text-fg-secondary">{t("profile.myWork.body")}</p>

      {completedCount === 0 ? (
        <p className="text-label text-fg-muted">{t("profile.myWork.none")}</p>
      ) : (
        <div className="flex items-end gap-3">
          <span className="text-headline tabular-nums text-fg">{completedCount}</span>
          <span className="pb-1 text-label text-fg-secondary">{t("profile.myWork.completed")}</span>
        </div>
      )}

      <Link href="/home/work" className="mt-auto">
        <Button type="button" variant="outline">
          {t("profile.myWork.manage")}
        </Button>
      </Link>
    </Card>
  );
}

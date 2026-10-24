"use client";

import { useActionState } from "react";
import { cn } from "@/lib/ui/cn";
import { useI18n } from "@/lib/i18n/context";
import { SubmitButton } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InboxIcon } from "@/components/ui/icons";
import { ownProductLifecycleAction, type OwnProductFormState } from "@/server/actions/own-products";
import { availableLifecycleActions, type OwnProductLifecycleAction, type OwnProductStatus } from "./product-input";

/** The shared geometry of the three card actions (Edit / Photos / Archive): same height, full cell width, icon + label. */
export const cardActionClass = "h-9 min-h-9 w-full gap-1 whitespace-nowrap px-1.5 text-caption font-medium";

const initial: OwnProductFormState = { ok: false };

function Hidden({ productId, version, action }: { productId: string; version: number; action: OwnProductLifecycleAction }) {
  return (
    <>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="action" value={action} />
    </>
  );
}

/** Activate / deactivate / restore: a plain one-click form. The server action revalidates the pages that show the product. */
function QuickAction({ productId, version, action }: { productId: string; version: number; action: Exclude<OwnProductLifecycleAction, "archive"> }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(ownProductLifecycleAction, initial);
  return (
    <form action={dispatch} className="inline-flex flex-col gap-1">
      <Hidden productId={productId} version={version} action={action} />
      <SubmitButton variant="outline" size="sm" pendingLabel={t("common.saving")}>
        {t(`showroomProducts.${action}`)}
      </SubmitButton>
      {state.code && !state.ok ? <span role="alert" className="text-label text-danger">{t(state.code)}</span> : null}
    </form>
  );
}

/**
 * The lifecycle buttons a product's status and the caller's capabilities allow.
 * Archiving asks first (it withdraws the product from the public catalog and
 * freezes editing); everything else is one click. The database re-checks every
 * transition — hiding a button here is a courtesy, never the control.
 */
export function LifecycleControls({
  productId,
  version,
  status,
  canWrite,
  canPublish,
}: {
  productId: string;
  version: number;
  status: OwnProductStatus;
  canWrite: boolean;
  canPublish: boolean;
}) {
  const { t } = useI18n();
  const actions = availableLifecycleActions(status, { write: canWrite, publish: canPublish });
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-start gap-1.5" role="group" aria-label={t("showroomProducts.actions")}>
      {actions.map((action) =>
        action === "archive" ? (
          <ConfirmDialog
            key={action}
            trigger={t("showroomProducts.archive")}
            triggerVariant="ghost"
            title={t("showroomProducts.archiveTitle")}
            body={t("showroomProducts.archiveBody")}
            confirmLabel={t("showroomProducts.archiveConfirm")}
            formAction={ownProductLifecycleAction}
          >
            <Hidden productId={productId} version={version} action="archive" />
          </ConfirmDialog>
        ) : (
          <QuickAction key={action} productId={productId} version={version} action={action} />
        ),
      )}
    </div>
  );
}

/**
 * The reference's on/off switch: "visible in Browse products". It is the same
 * activate / deactivate transition as the buttons (publish rights required, the
 * database decides), presented as a switch with its state exposed to assistive tech.
 */
export function ActiveSwitch({ productId, version, active, labelled = false }: { productId: string; version: number; active: boolean; labelled?: boolean }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(ownProductLifecycleAction, initial);
  return (
    <form action={dispatch} className="inline-flex flex-col gap-1">
      <Hidden productId={productId} version={version} action={active ? "deactivate" : "activate"} />
      <span className="inline-flex items-center gap-2">
      <button
        type="submit"
        role="switch"
        aria-checked={active}
        aria-label={t("showroomProducts.activeSwitch")}
        title={t("showroomProducts.activeSwitch")}
        data-testid="active-switch"
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          active ? "border-accent-edge bg-accent-solid" : "border-strong bg-surface-2",
        )}
      >
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-sm transition-all", active ? "end-0.5" : "start-0.5")} />
      </button>
      {labelled ? <span className="text-caption text-fg-secondary" aria-hidden="true">{t("showroomProducts.activeSwitch")}</span> : null}
      </span>
      {state.code && !state.ok ? <span role="alert" className="text-label text-danger">{t(state.code)}</span> : null}
    </form>
  );
}

/** Archive behind its confirmation (red outline, like the reference's destructive action). */
export function ArchiveAction({ productId, version }: { productId: string; version: number }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      trigger={t("showroomProducts.archive")}
      triggerVariant="danger"
      triggerIcon={<InboxIcon size={14} />}
      triggerClassName={cardActionClass}
      title={t("showroomProducts.archiveTitle")}
      body={t("showroomProducts.archiveBody")}
      confirmLabel={t("showroomProducts.archiveConfirm")}
      formAction={ownProductLifecycleAction}
    >
      <Hidden productId={productId} version={version} action="archive" />
    </ConfirmDialog>
  );
}

export function RestoreAction({ productId, version }: { productId: string; version: number }) {
  return <QuickAction productId={productId} version={version} action="restore" />;
}

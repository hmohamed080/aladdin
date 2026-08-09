"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import {
  startOrderAction,
  cancelOrderAction,
  createProjectAction,
  type FormState,
} from "@/server/actions/execution-forms";
import { Card, SectionTitle, Field, InlineError } from "@/components/ui/primitives";
import { Input, Textarea, LabeledField, SubmitButton, Button } from "@/components/ui/controls";
import { PackageIcon, ActivityIcon, CheckIcon, ClockIcon } from "@/components/ui/icons";
import { OrderStatusBadge } from "@/features/execution/badges";
import { formatDateTime } from "@/lib/ui/format";
import { formatMoney, formatQuantity } from "@/features/commerce/constants";
import type { OrderRow, OrderItemRow, ProjectRow } from "@/server/queries/execution";

const initial: FormState = { ok: false };

type Role = { isSupplier: boolean; isRequester: boolean; canManage: boolean; canProject: boolean };

export function OrderDetail({
  order,
  items,
  project,
  supplierName,
  requesterName,
  role,
  locale,
}: {
  order: OrderRow;
  items: OrderItemRow[];
  project: ProjectRow | null;
  supplierName: string;
  requesterName: string;
  role: Role;
  locale: Locale;
}) {
  const { t } = useI18n();
  const canStart = role.isSupplier && role.canManage && order.status === "confirmed";
  const canCancel = role.canManage && order.status === "confirmed";
  const canCreateProject =
    role.isSupplier && role.canProject && order.status === "in_progress" && !project;

  return (
    <div className="flex flex-col gap-lg">
      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2.5">
              <h1 className="text-headline text-fg">{order.title}</h1>
              <OrderStatusBadge status={order.status} />
            </div>
            <Link
              href={`/b2b/quotations/${order.quotation_id}`}
              className="text-label text-fg-secondary hover:text-fg"
            >
              {t("execution.order.viewQuotation")}
            </Link>
          </div>
          <div className="text-end">
            <p className="text-label text-fg-muted">{t("execution.order.total")}</p>
            <p className="text-title font-semibold tabular-nums text-fg" dir="ltr">
              {formatMoney(order.total, locale)}
            </p>
          </div>
        </div>
        <dl className="mt-md grid grid-cols-2 gap-md tablet:grid-cols-4">
          <Field label={t("execution.order.requester")}>{requesterName}</Field>
          <Field label={t("execution.order.supplier")}>{supplierName}</Field>
          <Field label={t("execution.order.confirmedAt")}>
            {formatDateTime(order.confirmed_at, locale)}
          </Field>
          <Field label={t("execution.order.itemsLabel")}>
            {t("execution.order.itemCount", { count: items.length })}
          </Field>
        </dl>
      </Card>

      {/* Commercial snapshot (immutable) */}
      <Card>
        <SectionTitle icon={<PackageIcon size={18} />}>{t("execution.order.lines")}</SectionTitle>
        <p className="mt-1 text-label text-fg-muted">{t("execution.order.snapshotHint")}</p>
        <div className="mt-md overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-body">
            <thead>
              <tr className="border-b text-label text-fg-muted">
                <th className="px-2 py-2 text-start font-medium">{t("commerce.fields.name")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("commerce.rfq.quantity")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("commerce.quotation.unitPrice")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("commerce.quotation.lineTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b last:border-0">
                  <td className="px-2 py-2.5 font-medium text-fg">{it.product_name}</td>
                  <td className="px-2 py-2.5 text-end tabular-nums" dir="ltr">
                    {formatQuantity(it.quantity, locale)} {t(`commerce.units.${it.unit}`)}
                  </td>
                  <td className="px-2 py-2.5 text-end tabular-nums" dir="ltr">
                    {formatMoney(it.unit_price, locale)}
                  </td>
                  <td className="px-2 py-2.5 text-end font-medium tabular-nums" dir="ltr">
                    {formatMoney(it.line_total, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2">
                <td colSpan={3} className="px-2 py-2.5 text-end text-label text-fg-muted">
                  {t("execution.order.total")}
                </td>
                <td className="px-2 py-2.5 text-end text-title font-semibold tabular-nums text-fg" dir="ltr">
                  {formatMoney(order.total, locale)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {order.note ? (
          <div className="mt-md border-t pt-md">
            <p className="text-label text-fg-muted">{t("execution.order.note")}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-body text-fg">{order.note}</p>
          </div>
        ) : null}
      </Card>

      {/* Execution timeline */}
      <Card>
        <SectionTitle icon={<ClockIcon size={18} />}>{t("execution.order.timeline")}</SectionTitle>
        <ol className="mt-md flex flex-col gap-2.5">
          <TimelineStep done label={t("execution.order.tlConfirmed")} at={order.confirmed_at} locale={locale} />
          <TimelineStep
            done={!!order.started_at}
            label={t("execution.order.tlStarted")}
            at={order.started_at}
            locale={locale}
          />
          {order.status === "cancelled" ? (
            <TimelineStep
              done
              tone="danger"
              label={t("execution.order.tlCancelled")}
              at={order.cancelled_at}
              locale={locale}
            />
          ) : (
            <TimelineStep
              done={!!order.completed_at}
              label={t("execution.order.tlCompleted")}
              at={order.completed_at}
              locale={locale}
            />
          )}
        </ol>
      </Card>

      {/* Next action */}
      {project ? (
        <Card>
          <SectionTitle icon={<ActivityIcon size={18} />}>{t("execution.order.projectLinked")}</SectionTitle>
          <p className="mt-1 text-label text-fg-muted">{t("execution.order.projectLinkedHint")}</p>
          <div className="mt-md">
            <Link href={`/b2b/projects/${project.id}`}>
              <Button variant="outline">{t("execution.order.openProject")}</Button>
            </Link>
          </div>
        </Card>
      ) : null}

      {(canStart || canCancel) && !project ? (
        <Card>
          <SectionTitle>{t("execution.order.actions")}</SectionTitle>
          <div className="mt-md flex flex-wrap items-center gap-md">
            {canStart ? <StartOrderForm orderId={order.id} version={order.version} /> : null}
            {canCancel ? <CancelOrderForm orderId={order.id} /> : null}
          </div>
        </Card>
      ) : null}

      {canCreateProject ? <CreateProjectCard orderId={order.id} defaultTitle={order.title} /> : null}
    </div>
  );
}

function TimelineStep({
  done,
  label,
  at,
  locale,
  tone = "success",
}: {
  done: boolean;
  label: string;
  at: string | null;
  locale: Locale;
  tone?: "success" | "danger";
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={
          done
            ? tone === "danger"
              ? "flex size-6 items-center justify-center rounded-pill bg-danger/15 text-danger"
              : "flex size-6 items-center justify-center rounded-pill bg-success/15 text-success"
            : "flex size-6 items-center justify-center rounded-pill bg-surface-2 text-fg-muted"
        }
      >
        <CheckIcon size={14} />
      </span>
      <span className={done ? "text-body text-fg" : "text-body text-fg-muted"}>{label}</span>
      {at ? <span className="ms-auto text-label text-fg-muted">{formatDateTime(at, locale)}</span> : null}
    </li>
  );
}

function StartOrderForm({ orderId, version }: { orderId: string; version: number }) {
  const { t } = useI18n();
  const [state, action] = useActionState(startOrderAction, initial);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <SubmitButton variant="accent" pendingLabel={t("common.saving")}>
        {t("execution.order.start")}
      </SubmitButton>
      {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}

function CancelOrderForm({ orderId }: { orderId: string }) {
  const { t } = useI18n();
  const [state, action] = useActionState(cancelOrderAction, initial);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <SubmitButton variant="danger" pendingLabel={t("common.saving")}>
        {t("execution.order.cancel")}
      </SubmitButton>
      {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}

function CreateProjectCard({ orderId, defaultTitle }: { orderId: string; defaultTitle: string }) {
  const { t } = useI18n();
  const [state, action] = useActionState(createProjectAction, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <Card>
      <SectionTitle icon={<ActivityIcon size={18} />}>{t("execution.order.startProject")}</SectionTitle>
      <p className="mt-1 text-label text-fg-muted">{t("execution.order.startProjectHint")}</p>
      <form action={action} className="mt-md flex flex-col gap-md" noValidate>
        <input type="hidden" name="orderId" value={orderId} />
        <div className="grid gap-md tablet:grid-cols-2">
          <div className="tablet:col-span-2">
            <LabeledField label={t("execution.project.titleField")} htmlFor="title" error={fe.title ? t(fe.title) : undefined}>
              <Input id="title" name="title" defaultValue={defaultTitle} maxLength={200} required />
            </LabeledField>
          </div>
          <LabeledField label={t("execution.project.location")} htmlFor="location" optional={t("common.optional")}>
            <Input id="location" name="location" maxLength={200} />
          </LabeledField>
          <div />
          <LabeledField label={t("execution.project.startDate")} htmlFor="startDate" optional={t("common.optional")}>
            <Input id="startDate" name="startDate" type="date" dir="ltr" />
          </LabeledField>
          <LabeledField
            label={t("execution.project.targetDate")}
            htmlFor="targetDate"
            optional={t("common.optional")}
            error={fe.targetDate ? t(fe.targetDate) : undefined}
          >
            <Input id="targetDate" name="targetDate" type="date" dir="ltr" />
          </LabeledField>
          <div className="tablet:col-span-2">
            <LabeledField label={t("execution.project.description")} htmlFor="description" optional={t("common.optional")}>
              <Textarea id="description" name="description" maxLength={2000} />
            </LabeledField>
          </div>
        </div>
        <div className="flex items-center gap-md">
          <SubmitButton variant="accent" pendingLabel={t("common.saving")}>
            {t("execution.order.createProject")}
          </SubmitButton>
          {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
        </div>
      </form>
    </Card>
  );
}

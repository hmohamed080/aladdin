import Link from "next/link";
import { fmtEgp } from "@/features/marketplace/live/live-copy";
import { ESCALATION_LABEL, REFUND_METHOD_LABEL, RETURN_COPY, RETURN_EVENT_LABEL, RETURN_ROLE_LABEL, RETURN_STATUS_LABEL, returnStateText } from "./copy";
import { ReturnActions } from "./return-actions";
import { EvidenceList } from "./evidence-list";
import type { ReturnDocument, ReturnEvent, ReturnSummary } from "./contract";

type Locale = "ar" | "en";
type Role = "buyer" | "seller" | "admin";

/** Rendered on the server, so the zone is named: a bare format would show the server's UTC clock. */
export const returnDateTime = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }).format(new Date(iso));

const ORDER_HREF: Partial<Record<Role, string>> = { buyer: "/market/orders", seller: "/showroom/marketplace/orders" };

export function ReturnList({ items, locale, base }: { items: ReturnSummary[]; locale: Locale; base: string }) {
  if (items.length === 0) return <p className="p-md text-body text-fg-secondary">{RETURN_COPY.empty[locale]}</p>;
  return (
    <ul className="flex flex-col divide-y rounded-md border bg-surface shadow-card">
      {items.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-sm p-md">
          <span className="grid gap-1">
            <Link href={`${base}/${r.id}`} className="font-semibold text-fg underline-offset-2 hover:underline">
              <bdi dir="ltr">{r.request_number}</bdi>
            </Link>
            <span className="text-caption text-fg-muted">
              {RETURN_COPY.order[locale]} <bdi dir="ltr">{r.order_number}</bdi>
              {r.buyer_name ? <> · {r.buyer_name}</> : null} · {returnDateTime(r.created_at, locale)}
            </span>
            {r.in_admin_queue && r.escalated_reason ? <span className="text-caption text-fg-secondary">{ESCALATION_LABEL[r.escalated_reason][locale]}</span> : null}
          </span>
          <span className="text-label text-fg-secondary">{RETURN_STATUS_LABEL[r.status][locale]}</span>
          <span className="tabular-nums">{fmtEgp(Number(r.value_egp), locale)}</span>
          {r.action_needed ? <span className="rounded-full bg-warning/10 px-sm text-caption font-semibold text-warning">{RETURN_COPY.actionNeeded[locale]}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** The note of a history row in the reader's language: stored codes and the English copy of a decision are never shown raw. */
function eventNote(e: ReturnEvent, doc: ReturnDocument, locale: Locale): string | null {
  if (!e.note) return null;
  if (e.action === "escalated" && Object.hasOwn(ESCALATION_LABEL, e.note)) return ESCALATION_LABEL[e.note as keyof typeof ESCALATION_LABEL][locale];
  if ((e.action === "approved" || e.action === "rejected") && doc.decision && e.note === doc.decision.message_en) {
    return (locale === "ar" ? doc.decision.message_ar : doc.decision.message_en) ?? e.note;
  }
  return e.note;
}

export function ReturnDetail({ doc, role, locale }: { doc: ReturnDocument; role: Role; locale: Locale }) {
  const reason = locale === "ar" ? doc.reason.label_ar : doc.reason.label_en;
  const t = (k: keyof typeof RETURN_COPY) => RETURN_COPY[k][locale];
  const decision = doc.decision ? (locale === "ar" ? doc.decision.message_ar : doc.decision.message_en) : null;
  const orderHref = ORDER_HREF[role];
  const order = <bdi dir="ltr">{doc.order_number}</bdi>;
  const state = returnStateText(doc, role, locale, (iso) => returnDateTime(iso, locale), (n) => fmtEgp(n, locale));
  const party = (p: { name: string; phone?: string | null }) => (
    <>
      {p.name}
      {p.phone ? <> · <a href={`tel:${p.phone}`} dir="ltr" className="underline underline-offset-2">{p.phone}</a></> : null}
    </>
  );
  const facts: [string, React.ReactNode][] = [
    [t("order"), orderHref ? <Link href={`${orderHref}/${doc.order_id}`} className="underline underline-offset-2">{order}</Link> : order],
    ...(role !== "buyer" && doc.buyer
      ? ([[t("buyer"), party(doc.buyer)]] as [string, React.ReactNode][])
      : []),
    ...(role !== "seller" ? ([[t("showroom"), party(doc.seller)]] as [string, React.ReactNode][]) : []),
    [t("sentAt"), returnDateTime(doc.timestamps.created_at, locale)],
    ...(doc.return_tracking ? ([[t("trackingNumber"), <bdi key="t" dir="ltr">{doc.return_tracking}</bdi>]] as [string, React.ReactNode][]) : []),
    ...(doc.partial_refund_egp !== null ? ([[t("partialProposed"), fmtEgp(Number(doc.partial_refund_egp), locale)]] as [string, React.ReactNode][]) : []),
    ...(doc.refund
      ? ([[t("refundRecorded"), `${fmtEgp(Number(doc.refund.amount_egp), locale)} · ${REFUND_METHOD_LABEL[doc.refund.method]?.[locale] ?? doc.refund.method}${doc.refund.sent_at ? ` · ${returnDateTime(doc.refund.sent_at, locale)}` : ""}${doc.refund.reference_note ? ` · ${doc.refund.reference_note}` : ""}`]] as [string, React.ReactNode][])
      : []),
  ];
  return (
    <div className="flex flex-col gap-md">
      <header className="flex flex-wrap items-center justify-between gap-sm">
        <h2 className="text-title">
          <bdi dir="ltr">{doc.request_number}</bdi> · {RETURN_STATUS_LABEL[doc.status][locale]}
        </h2>
        <span className="text-label text-fg-secondary">{reason}</span>
      </header>
      {state ? <p role="status" className="rounded-md border bg-surface p-md text-body">{state}</p> : null}
      <dl className="grid gap-xs rounded-md border bg-surface p-md text-body">
        {facts.map(([k, v]) => (
          <div key={k} className="flex flex-wrap gap-sm">
            <dt className="text-fg-secondary">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        {doc.buyer_note ? (
          <div className="flex flex-wrap gap-sm"><dt className="text-fg-secondary">{t("buyerNote")}</dt><dd>{doc.buyer_note}</dd></div>
        ) : null}
        {decision && doc.decision ? (
          <div className="flex flex-wrap gap-sm"><dt className="text-fg-secondary">{t("decisionBy")} {RETURN_ROLE_LABEL[doc.decision.by]?.[locale]}</dt><dd>{decision}</dd></div>
        ) : null}
      </dl>
      <ul className="flex flex-col divide-y rounded-md border bg-surface">
        {doc.items.map((i) => (
          <li key={i.item_id} className="flex justify-between gap-sm p-sm">
            <span>{locale === "ar" ? i.name_ar : i.name_en} × {i.quantity}</span>
            <span className="tabular-nums">{fmtEgp(Number(i.line_total_egp), locale)}</span>
          </li>
        ))}
      </ul>
      <EvidenceList evidence={doc.evidence} locale={locale} />
      <ReturnActions doc={doc} role={role} locale={locale} />
      <section aria-label={RETURN_COPY.events[locale]}>
        <h3 className="text-label font-semibold">{RETURN_COPY.events[locale]}</h3>
        <ol className="mt-sm flex flex-col gap-1 text-body">
          {doc.events.map((e) => {
            const note = eventNote(e, doc, locale);
            return (
              <li key={e.id}>
                <span className="text-fg-secondary">{RETURN_ROLE_LABEL[e.actor_role]?.[locale] ?? e.actor_role} · {RETURN_EVENT_LABEL[e.action]?.[locale] ?? e.action}</span>
                {note ? <span> — {note}</span> : null}
                <span className="block text-caption text-fg-muted"><time dateTime={e.at}>{returnDateTime(e.at, locale)}</time></span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

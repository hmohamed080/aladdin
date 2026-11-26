import Link from "next/link";
import { formatEgp } from "@/lib/ui/egp-format";
import { RETURN_COPY, RETURN_STATUS_LABEL } from "./copy";
import { ReturnActions } from "./return-actions";
import { EvidenceList } from "./evidence-list";
import type { ReturnDocument, ReturnSummary } from "./contract";

type Locale = "ar" | "en";
type Role = "buyer" | "seller" | "admin";

export function ReturnList({ items, locale, base }: { items: ReturnSummary[]; locale: Locale; base: string }) {
  if (items.length === 0) return <p className="p-md text-body text-fg-secondary">{RETURN_COPY.empty[locale]}</p>;
  return (
    <ul className="flex flex-col divide-y rounded-md border bg-surface shadow-card">
      {items.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-sm p-md">
          <Link href={`${base}/${r.id}`} className="font-semibold text-fg underline-offset-2 hover:underline">
            <bdi dir="ltr">{r.request_number}</bdi>
          </Link>
          <span className="text-label text-fg-secondary">{RETURN_STATUS_LABEL[r.status][locale]}</span>
          <span className="tabular-nums">{formatEgp(Number(r.value_egp), locale)}</span>
          {r.action_needed ? <span className="rounded-full bg-warning/10 px-sm text-caption font-semibold text-warning">!</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function ReturnDetail({ doc, role, locale }: { doc: ReturnDocument; role: Role; locale: Locale }) {
  const reason = locale === "ar" ? doc.reason.label_ar : doc.reason.label_en;
  return (
    <div className="flex flex-col gap-md">
      <header className="flex flex-wrap items-center justify-between gap-sm">
        <h2 className="text-title">
          <bdi dir="ltr">{doc.request_number}</bdi> · {RETURN_STATUS_LABEL[doc.status][locale]}
        </h2>
        <span className="text-label text-fg-secondary">{reason}</span>
      </header>
      <ul className="flex flex-col divide-y rounded-md border bg-surface">
        {doc.items.map((i) => (
          <li key={i.item_id} className="flex justify-between gap-sm p-sm">
            <span>{locale === "ar" ? i.name_ar : i.name_en} × {i.quantity}</span>
            <span className="tabular-nums">{formatEgp(Number(i.line_total_egp), locale)}</span>
          </li>
        ))}
      </ul>
      <EvidenceList evidence={doc.evidence} locale={locale} />
      <ReturnActions doc={doc} role={role} locale={locale} />
      <section aria-label={RETURN_COPY.events[locale]}>
        <h3 className="text-label font-semibold">{RETURN_COPY.events[locale]}</h3>
        <ol className="mt-sm flex flex-col gap-1 text-body">
          {doc.events.map((e) => (
            <li key={e.id}>
              <span className="text-fg-secondary">{e.actor_role} · {e.action}</span>
              {e.note ? <span> — {e.note}</span> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

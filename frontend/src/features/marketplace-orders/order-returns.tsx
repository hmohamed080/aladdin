import Link from "next/link";
import { RETURN_STATUS_LABEL } from "@/features/marketplace-returns/copy";
import type { ReturnStatus } from "@/features/marketplace-returns/contract";
import type { OrderDocumentV2 } from "./order-types";

/** The return requests of one order, each linking to its page for the viewer (`base`). */
export function OrderReturnLinks({ returns, base, locale }: { returns: OrderDocumentV2["returns"]; base: string; locale: "ar" | "en" }) {
  return (
    <ul className="grid gap-xs">
      {returns.map((r) => (
        <li key={r.id} className="flex flex-wrap justify-between gap-sm text-body">
          <Link href={`${base}/${r.id}`} className="font-semibold text-fg underline-offset-2 hover:underline">
            <bdi dir="ltr">{r.request_number}</bdi>
          </Link>
          <span className="text-label text-fg-secondary">{RETURN_STATUS_LABEL[r.status as ReturnStatus]?.[locale] ?? r.status}</span>
        </li>
      ))}
    </ul>
  );
}

"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import {
  Button,
  Input,
  LabeledField,
  Textarea,
} from "@/components/ui/controls";
import { Card } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  saveRequestResponseAction,
  withdrawRequestResponseAction,
} from "@/server/actions/purchase-requests";
import type { RequestDetailView } from "./model";

export function MaterialResponseForm({
  request,
  orgId,
}: {
  request: RequestDetailView;
  orgId: string;
}) {
  const { locale, t } = useI18n();
  const ar = locale === "ar";
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [lines, setLines] = useState(
    request.items.map((i) => {
      const previous = request.myResponse?.items.find(
        (r) => r.requestItemId === i.id,
      );
      return {
        requestItemId: i.id,
        offeredQuantity: String(previous?.offeredQuantity ?? i.quantity),
        unitPrice: previous ? String(previous.unitPrice) : "",
        note: previous?.note ?? "",
      };
    }),
  );
  const [note, setNote] = useState(request.myResponse?.note ?? "");
  const [validUntil, setValidUntil] = useState(
    request.myResponse?.validUntil ?? "",
  );
  return (
    <Card>
      <h2 className="mb-md text-title">
        {ar ? "عرضك لهذا الطلب" : "Your response"}
      </h2>
      {request.myResponse && (
        <p className="mb-md text-body">
          {ar ? "آخر عرض: " : "Last response: "}
          {request.myResponse.total} EGP ·{" "}
          {request.myResponse.status === "withdrawn"
            ? ar
              ? "مسحوب"
              : "Withdrawn"
            : ar
              ? "تم الإرسال"
              : "Submitted"}
        </p>
      )}
      {request.canRespond && request.status === "published" && (
        <form
          className="flex flex-col gap-md"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            start(async () => {
              try {
                const fd = new FormData();
                fd.set("orgId", orgId);
                fd.set("requestId", request.id);
                fd.set("note", note);
                fd.set("validUntil", validUntil);
                fd.set(
                  "lines",
                  JSON.stringify(
                    lines.filter((l) => l.unitPrice.trim() !== ""),
                  ),
                );
                const result = await saveRequestResponseAction(
                  { ok: false },
                  fd,
                );
                if (!result.ok)
                  setError(
                    result.code
                      ? t(result.code)
                      : ar
                        ? "راجع الكميات والأسعار وتاريخ الصلاحية."
                        : "Check quantities, prices and validity date.",
                  );
                else router.refresh();
              } catch {
                setError(t("states.genericRetry"));
              }
            });
          }}
        >
          <p className="text-body text-fg-secondary">
            {ar
              ? "اترك السعر فارغاً للخامات غير المتاحة. العرض غير ملزم ولا ينشئ طلب شراء."
              : "Leave price blank for unavailable materials. This non-binding response does not create an order."}
          </p>
          {request.items.map((item, index) => (
            <fieldset
              key={item.id}
              className="grid gap-md rounded-md border p-md tablet:grid-cols-3"
            >
              <legend className="px-2 text-body font-medium">
                {item.name}
              </legend>
              <LabeledField
                label={ar ? "الكمية المتاحة" : "Offered quantity"}
                htmlFor={`quantity-${item.id}`}
              >
                <Input
                  id={`quantity-${item.id}`}
                  inputMode="decimal"
                  value={lines[index]!.offeredQuantity}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, n) =>
                        n === index
                          ? { ...l, offeredQuantity: e.target.value }
                          : l,
                      ),
                    )
                  }
                />
              </LabeledField>
              <LabeledField
                label={ar ? "سعر الوحدة (ج.م)" : "Unit price (EGP)"}
                htmlFor={`price-${item.id}`}
              >
                <Input
                  id={`price-${item.id}`}
                  inputMode="decimal"
                  value={lines[index]!.unitPrice}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, n) =>
                        n === index ? { ...l, unitPrice: e.target.value } : l,
                      ),
                    )
                  }
                />
              </LabeledField>
              <LabeledField
                label={ar ? "ملاحظات الخامة" : "Material notes"}
                htmlFor={`note-${item.id}`}
              >
                <Input
                  id={`note-${item.id}`}
                  maxLength={250}
                  value={lines[index]!.note}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, n) =>
                        n === index ? { ...l, note: e.target.value } : l,
                      ),
                    )
                  }
                />
              </LabeledField>
            </fieldset>
          ))}
          <LabeledField
            label={ar ? "ملاحظات العرض" : "Response notes"}
            htmlFor="response-note"
          >
            <Textarea
              id="response-note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </LabeledField>
          <LabeledField
            label={ar ? "صالح حتى (اختياري)" : "Valid until (optional)"}
            htmlFor="response-validity"
          >
            <Input
              type="date"
              id="response-validity"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </LabeledField>
          <Button type="submit" disabled={pending}>
            {ar ? "إرسال عرض السعر" : "Submit response"}
          </Button>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </form>
      )}
      {request.myResponse?.status === "submitted" && (
        <ConfirmDialog
          trigger={ar ? "سحب العرض" : "Withdraw response"}
          title={ar ? "سحب العرض" : "Withdraw response"}
          confirmLabel={ar ? "تأكيد السحب" : "Confirm withdrawal"}
          formAction={async () => {
            try {
              return await withdrawRequestResponseAction(
                request.myResponse!.id,
              );
            } catch {
              return { ok: false, code: "states.genericRetry" };
            }
          }}
        />
      )}
    </Card>
  );
}

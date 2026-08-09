"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import {
  createProductAction,
  updateProductAction,
  type FormState,
} from "@/server/actions/commerce-forms";
import { Card } from "@/components/ui/primitives";
import { Input, Textarea, Select, LabeledField, SubmitButton } from "@/components/ui/controls";
import { PRODUCT_CATEGORIES, PRODUCT_UNITS } from "@/features/commerce/constants";
import type { ProductRow } from "@/server/queries/commerce";

const initial: FormState = { ok: false };

/**
 * Create/edit a catalog product. Binds directly to the trusted create_product /
 * update_product RPCs via Server Actions. In edit mode an optimistic version
 * guard is carried; entered values survive a validation error (uncontrolled +
 * defaultValue).
 */
export function ProductForm({
  orgId,
  product,
}: {
  orgId: string;
  product?: ProductRow;
}) {
  const { t } = useI18n();
  const editing = Boolean(product);
  const [state, action] = useActionState(
    editing ? updateProductAction : createProductAction,
    initial,
  );
  const fe = state.fieldErrors ?? {};

  return (
    <Card className="max-w-2xl">
      {state.code && !state.ok ? (
        <p
          role="alert"
          className="mb-md rounded-sm border border-danger/40 bg-danger/10 px-md py-2 text-body text-danger"
        >
          {t(state.code)}
        </p>
      ) : null}

      <form action={action} className="grid gap-md tablet:grid-cols-2" noValidate>
        {editing ? (
          <>
            <input type="hidden" name="productId" value={product!.id} />
            <input type="hidden" name="expectedVersion" value={product!.version} />
          </>
        ) : (
          <input type="hidden" name="orgId" value={orgId} />
        )}

        <div className="tablet:col-span-2">
          <LabeledField
            label={t("commerce.fields.name")}
            htmlFor="name"
            error={fe.name ? t(fe.name) : undefined}
          >
            <Input
              id="name"
              name="name"
              required
              maxLength={160}
              defaultValue={product?.name ?? ""}
              aria-invalid={fe.name ? true : undefined}
            />
          </LabeledField>
        </div>

        <LabeledField
          label={t("commerce.fields.category")}
          htmlFor="category"
          error={fe.category ? t(fe.category) : undefined}
        >
          <Select id="category" name="category" defaultValue={product?.category ?? ""}>
            <option value="" disabled>
              {t("commerce.fields.selectCategory")}
            </option>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`commerce.categories.${c}`)}
              </option>
            ))}
          </Select>
        </LabeledField>

        <LabeledField
          label={t("commerce.fields.unit")}
          htmlFor="unit"
          error={fe.unit ? t(fe.unit) : undefined}
        >
          <Select id="unit" name="unit" defaultValue={product?.unit ?? ""}>
            <option value="" disabled>
              {t("commerce.fields.selectUnit")}
            </option>
            {PRODUCT_UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`commerce.units.${u}`)}
              </option>
            ))}
          </Select>
        </LabeledField>

        <LabeledField label={t("commerce.fields.sku")} htmlFor="sku" optional={t("common.optional")}>
          <Input id="sku" name="sku" maxLength={80} dir="ltr" defaultValue={product?.sku ?? ""} />
        </LabeledField>

        <LabeledField
          label={t("commerce.fields.brand")}
          htmlFor="brand"
          optional={t("common.optional")}
        >
          <Input id="brand" name="brand" maxLength={120} defaultValue={product?.brand ?? ""} />
        </LabeledField>

        <div className="tablet:col-span-2">
          <LabeledField
            label={t("commerce.fields.description")}
            htmlFor="shortDescription"
            optional={t("common.optional")}
          >
            <Textarea
              id="shortDescription"
              name="shortDescription"
              maxLength={600}
              defaultValue={product?.short_description ?? ""}
            />
          </LabeledField>
        </div>

        <div className="tablet:col-span-2">
          <SubmitButton pendingLabel={t("common.saving")}>
            {editing ? t("common.saveChanges") : t("common.create")}
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}

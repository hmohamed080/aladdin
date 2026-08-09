"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Input, Select, Button } from "@/components/ui/controls";
import { PRODUCT_CATEGORIES } from "@/features/commerce/constants";

/** Catalog search + category filter. Writes to the URL; the server refetches
 *  within RLS (published products only). */
export function CatalogFilters({ defaults }: { defaults: { q: string; category: string } }) {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(defaults.q);

  const push = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`/b2b/catalog?${next.toString()}`);
  };

  return (
    <form
      className="mb-lg flex flex-wrap items-end gap-sm"
      onSubmit={(e) => {
        e.preventDefault();
        push({ q });
      }}
      role="search"
      data-no-dirty
    >
      <label className="flex-1 basis-56">
        <span className="sr-only">{t("commerce.catalog.searchPlaceholder")}</span>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("commerce.catalog.searchPlaceholder")}
          aria-label={t("commerce.catalog.searchPlaceholder")}
        />
      </label>
      <label>
        <span className="sr-only">{t("commerce.fields.category")}</span>
        <Select
          defaultValue={defaults.category}
          aria-label={t("commerce.fields.category")}
          onChange={(e) => push({ category: e.target.value })}
        >
          <option value="">{t("commerce.catalog.allCategories")}</option>
          {PRODUCT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`commerce.categories.${c}`)}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" variant="outline">
        {t("common.search")}
      </Button>
    </form>
  );
}

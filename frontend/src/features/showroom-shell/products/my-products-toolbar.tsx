"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button, Input } from "@/components/ui/controls";
import { SelectMenu } from "@/components/ui/select-menu";
import { PlusIcon, SearchIcon } from "@/components/ui/icons";
import { CANONICAL_CATEGORY_CODES } from "@/features/commerce/constants";
import { MY_PRODUCTS_SORTS } from "./my-products-params";

/**
 * The My products toolbar: Add product + search on one row, category and sort on the
 * next — URL-driven like every list in the suite, so a filtered shelf is a shareable
 * link and the page stays a server component. Selects apply at once; the text
 * search applies on submit.
 */
export function MyProductsToolbar({
  basePath,
  q,
  category,
  sort,
  canCreate,
}: {
  basePath: string;
  q: string;
  category: string;
  sort: string;
  canCreate: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [text, setText] = useState(q);

  const push = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v && !(k === "sort" && v === "updated")) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  };

  return (
    <div className="flex flex-col gap-sm" data-testid="my-products-toolbar">
      <form
        role="search"
        data-no-dirty
        className="flex flex-wrap items-stretch gap-sm"
        onSubmit={(e) => {
          e.preventDefault();
          push({ q: text.trim() });
        }}
      >
        {canCreate ? (
          <Link
            href={`${basePath}/new`}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-sm bg-accent-solid ring-1 ring-accent-edge px-md text-label font-semibold text-on-accent shadow-sm hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            data-testid="add-product"
          >
            <PlusIcon size={16} />
            {t("showroomProducts.create")}
          </Link>
        ) : null}
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">{t("showroomProducts.searchPlaceholder")}</span>
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-fg-muted">
            <SearchIcon size={16} />
          </span>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("showroomProducts.searchPlaceholder")} aria-label={t("showroomProducts.searchPlaceholder")} className="ps-9" />
        </label>
        <Button type="submit" variant="outline" className="shrink-0">
          {t("common.search")}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-sm">
        <div className="min-w-0 basis-44">
          <SelectMenu
            value={category}
            aria-label={t("showroomProducts.category")}
            onChange={(value) => push({ category: value })}
            data-testid="category-filter"
            options={[
              { value: "", label: t("showroomProducts.allCategories") },
              ...CANONICAL_CATEGORY_CODES.map((c) => ({ value: c, label: t(`commerce.canonicalCategories.${c}`) })),
              // Only a FILTER can ask for "unclassified" (historical products); a product itself never takes it.
              { value: "unclassified", label: t("showroomProducts.unclassified") },
            ]}
          />
        </div>
        <div className="min-w-0 basis-44">
          <SelectMenu
            value={sort}
            aria-label={t("showroomProducts.sortLabel")}
            onChange={(value) => push({ sort: value })}
            data-testid="sort-select"
            options={MY_PRODUCTS_SORTS.map((s) => ({ value: s, label: t(`showroomProducts.sort.${s}`) }))}
          />
        </div>
        {q || category ? (
          <Button type="button" variant="ghost" onClick={() => { setText(""); push({ q: "", category: "" }); }}>
            {t("showroomProducts.clearFilters")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

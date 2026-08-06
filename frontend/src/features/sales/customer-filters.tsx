"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Input, Select, Button } from "@/components/ui/controls";

/** Client-side filter bar that writes to the URL (server refetches within RLS). */
export function CustomerFilters({
  branches,
  defaults,
}: {
  branches: { id: string; name: string }[];
  defaults: { q: string; status: string; branch: string };
}) {
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
    router.push(`/b2b/customers?${next.toString()}`);
  };

  return (
    <form
      className="mb-md flex flex-wrap items-end gap-sm"
      onSubmit={(e) => {
        e.preventDefault();
        push({ q });
      }}
      role="search"
      // A search/filter form is not an edit — never treat it as a dirty form for
      // the Realtime open-edit guard (SalesRealtime reads this attribute).
      data-no-dirty
    >
      <label className="flex-1">
        <span className="sr-only">{t("customers.searchName")}</span>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("customers.searchName")}
          aria-label={t("customers.searchName")}
        />
      </label>
      <label>
        <span className="sr-only">{t("customers.status")}</span>
        <Select
          defaultValue={defaults.status}
          aria-label={t("customers.status")}
          onChange={(e) => push({ status: e.target.value })}
        >
          <option value="">{t("common.all")}</option>
          <option value="active">{t("customers.statusActive")}</option>
          <option value="archived">{t("customers.statusArchived")}</option>
        </Select>
      </label>
      {branches.length > 0 ? (
        <label>
          <span className="sr-only">{t("customers.branch")}</span>
          <Select
            defaultValue={defaults.branch}
            aria-label={t("customers.branch")}
            onChange={(e) => push({ branch: e.target.value })}
          >
            <option value="">{t("nav.allBranches")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <Button type="submit" variant="outline">
        {t("common.search")}
      </Button>
    </form>
  );
}

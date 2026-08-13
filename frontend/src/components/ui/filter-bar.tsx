"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Input, Select, Button } from "@/components/ui/controls";
import { SearchIcon } from "@/components/ui/icons";

/**
 * One canonical list toolbar: free-text search plus zero or more dropdown filters,
 * all expressed in the URL so the server refetches inside RLS. A filter can narrow
 * results but never widen them past what the database already allows.
 *
 * Selects apply immediately (the expected behaviour for a small option set);
 * the text field applies on submit so typing does not fire a request per keystroke.
 */
export type FilterSelect = {
  /** Query-string parameter this select writes. */
  name: string;
  label: string;
  value: string;
  /** The "no filter" option label. Its value is always the empty string. */
  anyLabel: string;
  options: { value: string; label: string }[];
};

export function FilterBar({
  basePath,
  search,
  selects = [],
}: {
  basePath: string;
  search?: { name: string; value: string; placeholder: string };
  selects?: FilterSelect[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(search?.value ?? "");

  const push = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  };

  return (
    <form
      role="search"
      data-no-dirty
      className="mb-lg flex flex-wrap items-end gap-sm rounded-md border bg-surface p-sm shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (search) push({ [search.name]: q });
      }}
    >
      {search ? (
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">{search.placeholder}</span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-fg-muted"
          >
            <SearchIcon size={16} />
          </span>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            className="ps-9"
          />
        </label>
      ) : null}

      {selects.map((s) => (
        <label key={s.name} className="min-w-0 basis-44">
          <span className="sr-only">{s.label}</span>
          <Select value={s.value} aria-label={s.label} onChange={(e) => push({ [s.name]: e.target.value })}>
            <option value="">{s.anyLabel}</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      ))}

      {search ? (
        <Button type="submit" variant="outline">
          {t("common.search")}
        </Button>
      ) : null}
    </form>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { nextSort, type SortDir } from "@/features/admin-preview/table-state";

export type TextFieldConfig = {
  kind: "text";
  name: string;
  placeholder: string;
  /** `w-full max-w-sm` by default; pass to widen/narrow. */
  className?: string;
};

export type SelectFieldConfig = {
  kind: "select";
  name: string;
  anyLabel: string;
  options: { value: string; label: string }[];
};

export type DateFieldConfig = {
  kind: "date";
  name: string;
  /** Visible label above the input (e.g. "From"). */
  label: string;
};

export type FilterFieldConfig = TextFieldConfig | SelectFieldConfig | DateFieldConfig;

/**
 * Global Admin UX convention (Phase 0C): NO standalone "Search" button on a
 * normal directory — typing filters as-you-type (debounced) and changing a
 * select filters immediately. Reads the current values from the URL
 * (`useSearchParams`) so the page stays a plain Server Component reading
 * `searchParams` — this component only ever *navigates* (`router.replace`,
 * `scroll: false`), the actual filtering/fetching logic on every page is
 * completely unchanged. Changing any field resets `page` to 1 (a filter
 * change invalidates whatever page the reader was on) but preserves every
 * other query param not managed here (e.g. a status tab from `TabLinks`).
 *
 * One shared 300ms debounce timer for ALL text fields in the group (not one
 * timer per field) so two keystrokes across two boxes can't race and clobber
 * each other's URL update.
 */
export function AutoFilters({ fields }: { fields: FilterFieldConfig[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [textValues, setTextValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) if (f.kind === "text") initial[f.name] = searchParams.get(f.name) ?? "";
    return initial;
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function navigate(overrides: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate(textValues), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textValues]);

  return (
    <div className="flex flex-wrap gap-sm">
      {fields.map((f) =>
        f.kind === "text" ? (
          <input
            key={f.name}
            type="search"
            value={textValues[f.name] ?? ""}
            onChange={(e) => setTextValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
            placeholder={f.placeholder}
            className={
              f.className ??
              "min-h-10 w-full max-w-sm rounded-md border border-strong bg-canvas px-3.5 text-body text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
            }
          />
        ) : f.kind === "date" ? (
          <label key={f.name} className="flex flex-col gap-1 text-label text-fg-secondary">
            {f.label}
            <input
              type="date"
              value={searchParams.get(f.name) ?? ""}
              onChange={(e) => navigate({ [f.name]: e.target.value })}
              className="min-h-10 rounded-md border border-strong bg-canvas px-3 text-body text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
            />
          </label>
        ) : (
          <select
            key={f.name}
            value={searchParams.get(f.name) ?? ""}
            onChange={(e) => navigate({ [f.name]: e.target.value })}
            className="min-h-10 min-w-0 max-w-full rounded-md border border-strong bg-canvas px-3 text-body text-fg"
          >
            <option value="">{f.anyLabel}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ),
      )}
    </div>
  );
}

export type SortFieldConfig = { value: string; label: string };

/**
 * A sortable column header — a real, visibly-affordanced link (chevron
 * always shown, filled/active when this column is the current sort), never
 * a decorative arrow that does nothing. Toggles asc/desc on repeat click.
 * Same URL-param navigation model as `AutoFilters`.
 */
export function SortableHeader({
  field,
  label,
  naturalDir = "desc",
  isDefault = false,
}: {
  field: string;
  label: string;
  naturalDir?: SortDir;
  /** This column is the table's default sort when `?sort=` is absent — shown as active. */
  isDefault?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [currentField, currentDir] = (searchParams.get("sort") ?? "").split(":");
  const noSortParam = !currentField;
  const active = currentField === field || (noSortParam && isDefault);
  const dir: SortDir | null = active ? (noSortParam ? naturalDir : currentDir === "asc" ? "asc" : "desc") : null;

  return (
    <button
      type="button"
      aria-label={dir ? `${label} — ${t(dir === "asc" ? "admin.preview.users.sortAscending" : "admin.preview.users.sortDescending")}` : label}
      onClick={() => {
        const params = new URLSearchParams(searchParams.toString());
        // ONE sort param holds ONE field. Switching columns starts at the new
        // column's own natural direction — the previous column's direction
        // never carries over (Registered and Profile Completion are independent).
        params.set("sort", nextSort(dir ? { field, dir } : null, field, naturalDir));
        params.delete("page");
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }}
      className="inline-flex items-center gap-1 whitespace-nowrap text-label font-medium text-fg-muted transition-colors hover:text-fg"
    >
      {label}
      <span aria-hidden="true" className={active ? "text-accent" : "text-fg-muted/50"}>
        {dir === "asc" ? "▴" : dir === "desc" ? "▾" : "↕"}
      </span>
    </button>
  );
}

import Link from "next/link";
import { cn } from "@/lib/ui/cn";

export type CategoryChip = { value: string; label: string };

/**
 * A single scrolling row of category chips (All + the canonical categories), as in
 * the reference. They are plain links that keep the other filters, so the row is
 * keyboard-reachable and works without scripts. It scrolls inside itself — the page
 * never widens.
 */
export function CategoryChips({
  chips,
  selected,
  hrefFor,
  label,
}: {
  chips: CategoryChip[];
  selected: string;
  hrefFor: (value: string) => string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="min-w-0 overflow-x-auto pb-1" data-testid="category-chips">
      <ul className="flex w-max min-w-full gap-2">
        {chips.map((chip) => {
          const active = chip.value === selected;
          return (
            <li key={chip.value || "all"} className="shrink-0">
              <Link
                href={hrefFor(chip.value)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center rounded-sm border px-3 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  active ? "border-accent-edge bg-accent-solid text-on-accent" : "border-strong bg-surface text-fg-secondary hover:bg-surface-2",
                )}
              >
                {chip.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

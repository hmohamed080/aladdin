import Link from "next/link";
import type { ComponentType } from "react";
import type { Messages } from "@/lib/i18n/messages/en";
import { CardRail } from "@/components/ui/card-rail";
import {
  SearchIcon,
  ShoppingBagIcon,
  InboxIcon,
  BookmarkIcon,
  TruckIcon,
  WrenchIcon,
  UsersIcon,
  TargetIcon,
} from "@/components/ui/icons";

/**
 * "What do you want to do today?" — the workspace's entry ramp.
 *
 * Every tile is a real destination the caller is allowed to reach, chosen from
 * their capabilities. This exists because a dashboard full of numbers answers
 * "how are we doing" but not "what do I do now", and for a showroom the second
 * question is the one they open the app with.
 */
type Action = { href: string; label: string; body: string; Icon: ComponentType<{ size?: number }> };

export function QuickActions({
  m,
  capabilities,
}: {
  m: Messages;
  capabilities: readonly string[];
}) {
  const caps = new Set(capabilities);
  const has = (...keys: string[]) => caps.has("org.manage") || keys.some((k) => caps.has(k));

  const actions: Action[] = [];

  if (has("catalog.read", "rfq.create", "order.create")) {
    actions.push({
      href: "/b2b/catalog",
      label: m.home.action.browse,
      body: m.home.action.browseBody,
      Icon: SearchIcon,
    });
  }
  if (has("rfq.create")) {
    actions.push({
      href: "/b2b/rfqs",
      label: m.home.action.requests,
      body: m.home.action.requestsBody,
      Icon: ShoppingBagIcon,
    });
  }
  if (has("quote.decide", "rfq.create")) {
    actions.push({
      href: "/b2b/quotations",
      label: m.home.action.offers,
      body: m.home.action.offersBody,
      Icon: InboxIcon,
    });
  }
  if (has("catalog.read", "rfq.create", "order.create")) {
    actions.push({
      href: "/b2b/saved",
      label: m.home.action.saved,
      body: m.home.action.savedBody,
      Icon: BookmarkIcon,
    });
  }
  actions.push({
    href: "/b2b/suppliers",
    label: m.home.action.suppliers,
    body: m.home.action.suppliersBody,
    Icon: TruckIcon,
  });
  actions.push({
    href: "/b2b/technicians",
    label: m.home.action.technicians,
    body: m.home.action.techniciansBody,
    Icon: WrenchIcon,
  });
  if (has("sales.write", "sales.manage")) {
    actions.push({
      href: "/b2b/customers/new",
      label: m.home.addCustomer,
      body: m.home.action.customerBody,
      Icon: UsersIcon,
    });
    actions.push({
      href: "/b2b/leads/new",
      label: m.home.addLead,
      body: m.home.action.leadBody,
      Icon: TargetIcon,
    });
  }

  if (actions.length === 0) return null;

  return (
    <section aria-label={m.home.quickActions} className="flex flex-col gap-sm">
      <h2 className="text-title text-fg">{m.home.doToday}</h2>
      {/* An entry ramp is scanned once and then acted on, so it earns exactly one
          row. A showroom owner sees eight of these; stacked three-across they
          pushed the purchasing panels a full screen down the page. */}
      <CardRail label={m.home.doToday} itemWidth="17rem">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-start gap-3 rounded-md border bg-surface p-md shadow-card transition-colors hover:border-strong hover:bg-surface-2/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-accent-solid/12 text-accent"
              aria-hidden="true"
            >
              <a.Icon size={18} />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-fg group-hover:text-accent">{a.label}</span>
              <span className="mt-0.5 block text-label text-fg-secondary">{a.body}</span>
            </span>
          </Link>
        ))}
      </CardRail>
    </section>
  );
}

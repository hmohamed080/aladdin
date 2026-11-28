"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button, Checkbox, Input } from "@/components/ui/controls";
import { SearchIcon, TruckIcon } from "@/components/ui/icons";
import {
  listFreeShippingProductsAction,
  setProductFreeShippingAction,
  type FreeShippingProduct,
} from "@/server/actions/marketplace-seller";
import { errorKey } from "./errors";

type Message = { ok: boolean; text: string };

/**
 * Per-product free shipping: the showroom searches its products and ticks the ones that always ship free,
 * whatever the order value. The list loads on demand (a showroom can have thousands of products); each
 * tick is saved immediately by the database, which checks the product belongs to this showroom.
 */
export function FreeShippingProducts({ organizationId, initialCount }: { organizationId: string; initialCount: number }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<FreeShippingProduct[] | null>(null);
  const [count, setCount] = useState(initialCount);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [loading, startLoad] = useTransition();
  const [, startSwitch] = useTransition();
  const d = (key: string) => t(`marketplaceSeller.delivery.${key}`);
  const name = (p: FreeShippingProduct) => (locale === "ar" ? p.name_ar : p.name_en);

  const load = () => {
    setMessage(null);
    startLoad(async () => {
      const r = await listFreeShippingProductsAction(organizationId, search);
      if (!r.ok) {
        setMessage({ ok: false, text: t(errorKey(r.code)) });
        return;
      }
      setItems(r.items);
      setCount(r.flaggedCount);
    });
  };

  const toggle = (p: FreeShippingProduct, enabled: boolean) => {
    setMessage(null);
    startSwitch(async () => {
      const r = await setProductFreeShippingAction(organizationId, p.id, enabled);
      if (!r.ok) {
        setMessage({ ok: false, text: t(errorKey(r.code)) });
        return;
      }
      setItems((list) => (list ?? []).map((x) => (x.id === p.id ? { ...x, free_shipping: r.freeShipping } : x)));
      setCount((n) => Math.max(0, n + (r.freeShipping ? 1 : -1)));
      setMessage({ ok: true, text: d("freeShipSaved") });
    });
  };

  return (
    <section className="rounded-md border bg-surface p-md shadow-card" aria-labelledby="delivery-free-products">
      <h2 id="delivery-free-products" className="flex items-center gap-sm text-title text-fg">
        <TruckIcon size={20} />
        {d("freeShipTitle")}
      </h2>
      <p className="mt-1 text-label text-fg-secondary">{d("freeShipHint")}</p>
      <p className="mt-1 text-label text-fg-secondary">{d("freeShipCount").replace("{n}", String(count))}</p>

      <div className="mt-md flex flex-wrap items-end gap-sm">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-label text-fg">
          {d("freeShipSearch")}
          <Input
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") load();
            }}
          />
        </label>
        <Button variant="outline" onClick={load} disabled={loading} aria-busy={loading}>
          <SearchIcon size={16} />
          {d("freeShipSearch")}
        </Button>
      </div>

      {items !== null ? (
        items.length === 0 ? (
          <p className="mt-md text-body text-fg-secondary">{d("freeShipEmpty")}</p>
        ) : (
          <ul className="mt-md flex flex-col gap-sm">
            {items.map((p) => (
              <li key={p.id} className="rounded-sm border p-sm">
                <Checkbox
                  id={`free-${p.id}`}
                  name={`free-${p.id}`}
                  checked={p.free_shipping}
                  onChange={(on) => toggle(p, on)}
                >
                  {d("freeShipLabel").replace("{name}", name(p))}
                </Checkbox>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "mt-sm text-label text-success" : "mt-sm text-label text-danger"}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}

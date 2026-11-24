import type { Locale } from "../marketplace-types";
import { deliveryCopy } from "./live-delivery-copy";
import styles from "../marketplace-v2.module.css";

/** What every public Marketplace page shows while the platform team has the Marketplace closed (or a showroom is not listed). */
export function ClosedState({ locale, kind = "closed" }: { locale: Locale; kind?: "closed" | "seller_missing" }) {
  const t = deliveryCopy[locale];
  return (
    <section className={styles.closed} role="status">
      <h1 data-plain>{kind === "closed" ? t.closedTitle : t.sellerMissingTitle}</h1>
      <p>{kind === "closed" ? t.closedBody : t.sellerMissingBody}</p>
    </section>
  );
}

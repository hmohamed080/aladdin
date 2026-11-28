import "server-only";

import { listMyPortfolio, listMyPortfolioMedia } from "@/server/queries/portfolio";
import { createAssetReadUrl } from "@/server/actions/professional-assets";
import type { PortfolioCard } from "@/features/portfolio/portfolio-manager";

/**
 * The owner's works with their preview URLs, minted HERE at render, one per file
 * and in parallel. Short-lived by construction and never stored. A pending item
 * (or extra) has no bytes yet, so nothing is signed for it.
 */
export async function loadPortfolioCards(): Promise<PortfolioCard[]> {
  const [items, media] = await Promise.all([listMyPortfolio(), listMyPortfolioMedia()]);
  return Promise.all(
    items.map(async (item) => {
      const cover = item.pending ? null : await createAssetReadUrl("portfolio", item.objectKey);
      const extras = await Promise.all(
        media
          .filter((m) => m.itemId === item.id && !m.pending)
          .map(async (m) => {
            const url = await createAssetReadUrl("portfolio_media", m.objectKey);
            return { id: m.id, kind: m.kind, durationSeconds: m.durationSeconds, previewUrl: url.ok ? url.url : null };
          }),
      );
      return { ...item, previewUrl: cover?.ok ? cover.url : null, extras };
    }),
  );
}

"use client";

import { createContext, useContext, type ReactNode } from "react";
import { marketplaceImageSrc, type MarketplaceImageMap } from "@/lib/storage/marketplace-images";

/**
 * Public shop image URLs resolved on the server (`marketplacePublicImageUrls`): the media Worker
 * with its recorded sizes while public edge delivery is on, otherwise `/marketplace/media/<id>`.
 * An image not in the map (e.g. a cart line read in the browser) falls back to the route, which
 * hands over to the Worker itself.
 */
const ImageUrls = createContext<MarketplaceImageMap | undefined>(undefined);

export function MarketplaceImagesProvider({ images, children }: { images: MarketplaceImageMap; children: ReactNode }) {
  return <ImageUrls.Provider value={images}>{children}</ImageUrls.Provider>;
}

export function useMarketplaceImageSrc() {
  const images = useContext(ImageUrls);
  return (imageId: string, size: "thumb" | "card" | "full") => marketplaceImageSrc(images, imageId, size);
}

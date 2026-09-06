import "server-only";

import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Reads for Portfolio and Certificates.
 *
 * I/O ONLY — no rules live here. Every predicate that matters is already in the
 * database and cannot be skipped by a caller:
 *
 *   * `portfolio_items_select_own` and `certificates_select_own` restrict rows to
 *     their owner AND exclude `state = 'deleted'`, so a row awaiting object
 *     cleanup is invisible here without any query saying so. That is deliberate
 *     (§8): a cleanup state kept out of ordinary queries by POLICY cannot be
 *     resurfaced later by a hand-written select.
 *   * `public_portfolio_items` is the published projection — public AND ready AND
 *     on a currently listed profile — and carries no owner id, no storage key,
 *     no state and no visibility.
 *
 * So the only judgement in this file is which columns to ask for.
 */

export type PortfolioItem = {
  id: string;
  objectKey: string;
  contentType: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  /** `pending` means the bytes never arrived — the owner sees a recovery card. */
  pending: boolean;
  sortOrder: number;
  createdAt: string;
};

export type Certificate = {
  id: string;
  objectPath: string;
  contentType: string;
  title: string;
  issuer: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  originalFilename: string | null;
  pending: boolean;
  createdAt: string;
};

/** One published item as a visitor sees it. No owner, no key, no state. */
export type PublicPortfolioItem = {
  id: string;
  title: string;
  description: string | null;
};

export const listMyPortfolio = cache(async function listMyPortfolio(): Promise<PortfolioItem[]> {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("portfolio_items")
    .select("id, object_key, content_type, title, description, visibility, state, sort_order, created_at")
    // The same total order the public projection uses, so what the owner
    // arranges is exactly what a visitor sees. Ties break on created_at then id
    // so the order stays total even between two reorders.
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  return (data ?? []).map((r) => ({
    id: r.id,
    objectKey: r.object_key,
    contentType: r.content_type,
    title: r.title,
    description: r.description,
    isPublic: r.visibility === "public",
    pending: r.state === "pending",
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }));
});

export const listMyCertificates = cache(async function listMyCertificates(): Promise<Certificate[]> {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("professional_certificates")
    .select("id, object_path, content_type, title, issuer, issued_on, expires_on, original_filename, state, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });

  return (data ?? []).map((r) => ({
    id: r.id,
    objectPath: r.object_path,
    contentType: r.content_type,
    title: r.title,
    issuer: r.issuer,
    issuedOn: r.issued_on,
    expiresOn: r.expires_on,
    originalFilename: r.original_filename,
    pending: r.state === "pending",
    createdAt: r.created_at,
  }));
});

/**
 * The published portfolio of one profile, for `/p/[profileId]`.
 *
 * Reachable while signed out: the view grants SELECT to `anon`. It returns
 * nothing for an unlisted profile, which is the same answer it gives for a
 * profile with no published work — the page must not let a visitor tell those
 * apart, for the same reason `loadPublicProfile` collapses its three cases.
 */
export async function loadPublicPortfolio(profileId: string): Promise<PublicPortfolioItem[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("public_portfolio_items")
    .select("id, title, description, sort_order")
    .eq("profile_id", profileId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (error || !data) return [];
  // Every column of a view is nullable to the type generator, whatever the
  // underlying table says. Narrowing on the two the page cannot render without is
  // cheaper than asserting non-null, and it means a row that somehow arrived
  // incomplete is skipped rather than rendered as an empty card.
  return data.flatMap((r) =>
    r.id && r.title ? [{ id: r.id, title: r.title, description: r.description }] : [],
  );
}

export type ProfessionalAssetSummary = {
  portfolioTotal: number;
  portfolioPublished: number;
  portfolioPrivate: number;
  /** Unfinished uploads, counted separately: they are neither published nor usable. */
  portfolioUnfinished: number;
  certificateTotal: number;
  /** Already past its expiry date, which is a fact the holder should see. */
  certificatesExpired: number;
  /**
   * The newest few certificate NAMES, for the hub module.
   *
   * The reference account overview fills its certificates card with a row of
   * labels, and this is the honest version of that: the person's own titles,
   * which say more than a count and are the only thing there is to say — there is
   * no verification state to show beside them (S2).
   */
  certificateTitles: string[];
  /**
   * A PUBLISHED item, for the hub's preview, or null.
   *
   * Deliberately never falls back to a private item. The hub renders it through
   * `/p/media/<id>`, which resolves only for published work — so a fallback would
   * produce a broken image rather than a private one, but it would also be the
   * page quietly asking for something it is not entitled to.
   */
  previewItemId: string | null;
};

/**
 * The Profile-hub summary, derived from the two lists rather than from its own
 * queries: both are `cache()`d per render, so the hub reads the same rows the
 * modules do and cannot disagree with them about a count.
 */
export async function loadProfessionalAssetSummary(): Promise<ProfessionalAssetSummary> {
  const [portfolio, certificates] = await Promise.all([listMyPortfolio(), listMyCertificates()]);
  const usable = portfolio.filter((i) => !i.pending);
  const published = usable.filter((i) => i.isPublic);
  const today = new Date().toISOString().slice(0, 10);

  return {
    portfolioTotal: usable.length,
    portfolioPublished: published.length,
    portfolioPrivate: usable.length - published.length,
    portfolioUnfinished: portfolio.length - usable.length,
    certificateTotal: certificates.filter((c) => !c.pending).length,
    certificatesExpired: certificates.filter(
      (c) => !c.pending && c.expiresOn !== null && c.expiresOn < today,
    ).length,
    certificateTitles: certificates.filter((c) => !c.pending).slice(0, 3).map((c) => c.title),
    previewItemId: published[0]?.id ?? null,
  };
}

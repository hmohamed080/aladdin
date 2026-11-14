/**
 * Admin View-As — the account-kind registry (docs/admin/ADMIN_VIEW_AS_ARCHITECTURE.md §8).
 *
 * The framework (permission, sessions, guard, banner, link scope, read-only rules) knows nothing about any one account
 * kind. Each kind registers ONE definition here: which persona it applies to, and its read-only sections. Adding
 * Showroom later means a new entry plus its readers and `admin_view_*` functions behind the same database gate — no
 * framework change. Only Craftsman is registered today.
 *
 * Pure and client-safe: no server imports.
 */

export type ViewAsKind = "craftsman";

export type ViewAsSection = {
  /** Stable key (also the i18n key under `admin.viewAs.sections`). */
  readonly key: string;
  /** Path segment under the view base path ("" = the landing/dashboard). */
  readonly segment: string;
};

export type AccountViewDefinition = {
  readonly kind: ViewAsKind;
  /** The subject is a person (`user`) or, for business kinds in future, an organization. */
  readonly subjectType: "user";
  /** `users.primary_account_type` values this kind applies to. */
  readonly accountTypes: readonly string[];
  /** Read-only sections, in navigation order. */
  readonly sections: readonly ViewAsSection[];
};

export const ACCOUNT_VIEWS: Readonly<Record<ViewAsKind, AccountViewDefinition>> = {
  craftsman: {
    kind: "craftsman",
    subjectType: "user",
    accountTypes: ["installer_technician"],
    sections: [
      { key: "dashboard", segment: "" },
      { key: "profile", segment: "profile" },
      { key: "portfolio", segment: "portfolio" },
      { key: "work", segment: "work" },
      { key: "points", segment: "points" },
      { key: "reviews", segment: "reviews" },
    ],
  },
};

/** The view kind for a persona, or null when no view exists for it (the eye then stays on the normal profile link). */
export function viewKindForAccountType(accountType: string | null | undefined): ViewAsKind | null {
  if (!accountType) return null;
  for (const def of Object.values(ACCOUNT_VIEWS)) {
    if (def.accountTypes.includes(accountType)) return def.kind;
  }
  return null;
}

/** Base path of the read-only view of a user. The ONLY place this URL shape is built. */
export function viewAsBasePath(userId: string): string {
  return `/admin/users/${userId}/view`;
}

/**
 * The link scope: the ONLY way a view-as component builds an internal link. Every href lands under the view's own base
 * path, so navigation can never reach the Admin's own craftsman area (`/home/...`).
 */
/** The private-media namespaces a view may deliver (the database enforces the same list). */
export type ViewAsMediaNamespace = "avatar" | "portfolio" | "certificate";

/** The ONE URL shape for a viewed account's private file: an opaque media id on the view's own route, never a storage key. */
export function viewAsMediaHref(userId: string, namespace: ViewAsMediaNamespace, mediaId: string): string {
  return `${viewAsBasePath(userId)}/media/${namespace}/${mediaId}`;
}

export function viewAsHref(userId: string, segment: string): string {
  const base = viewAsBasePath(userId);
  return segment ? `${base}/${segment}` : base;
}

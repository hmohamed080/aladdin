/**
 * LinkScope (pure): maps the account's own `/home/...` routes onto the view tree `/view-as/<id>/...`.
 * Outside a view the identity is used, so a normal session never changes. Client-safe.
 */
const HOME = /^\/home(?=$|[/?#])/;

export type LinkScope = {
  /** `/view-as/<id>` or null (normal session). */
  readonly base: string | null;
  /** `/home/x` -> `/view-as/<id>/x`; anything else (external, hash, other routes) unchanged. */
  href(href: string): string;
  /** `/view-as/<id>/x` -> `/home/x` (for active-link matching against the shell's own `/home` hrefs). */
  unscope(pathname: string): string;
};

export function createLinkScope(base: string | null): LinkScope {
  return {
    base,
    href: (href) => (base && HOME.test(href) ? `${base}${href.slice("/home".length)}` : href),
    unscope: (pathname) => {
      if (!base) return pathname;
      if (pathname === base) return "/home";
      return pathname.startsWith(`${base}/`) ? `/home${pathname.slice(base.length)}` : pathname;
    },
  };
}

export const IDENTITY_SCOPE: LinkScope = createLinkScope(null);

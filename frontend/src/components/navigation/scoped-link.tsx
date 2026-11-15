"use client";

import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import NextLink from "next/link";
import { createLinkScope, IDENTITY_SCOPE, type LinkScope } from "@/lib/admin/view-as/link-scope";

type Ctx = { scope: LinkScope; readOnly: boolean };
const ViewAsCtx = createContext<Ctx>({ scope: IDENTITY_SCOPE, readOnly: false });

/** Wraps the view tree: every `ScopedLink` / `useLinkScope()` inside maps `/home/...` to `/view-as/<id>/...`. */
export function ViewAsScopeProvider({ base, children }: { base: string; children: ReactNode }) {
  return <ViewAsCtx.Provider value={{ scope: createLinkScope(base), readOnly: true }}>{children}</ViewAsCtx.Provider>;
}

export function useLinkScope(): LinkScope {
  return useContext(ViewAsCtx).scope;
}

/** True inside the view tree: owner-only controls render disabled. */
export function useViewAsReadOnly(): boolean {
  return useContext(ViewAsCtx).readOnly;
}

/** Drop-in for `next/link`: identity outside a view, `/home/...` -> `/view-as/<id>/...` inside. */
export function ScopedLink({ href, ...rest }: ComponentProps<typeof NextLink>) {
  const scope = useLinkScope();
  const mapped =
    typeof href === "string"
      ? scope.href(href)
      : href.pathname
        ? { ...href, pathname: scope.href(href.pathname) }
        : href;
  return <NextLink href={mapped} {...rest} />;
}

/** Wraps an owner-only control (sign out ...): live in a normal session, a disabled fieldset inside a view. */
export function OwnerOnly({ children }: { children: ReactNode }) {
  const readOnly = useViewAsReadOnly();
  if (!readOnly) return <>{children}</>;
  return (
    <fieldset disabled data-view-as-owner-only className="contents">
      {children}
    </fieldset>
  );
}

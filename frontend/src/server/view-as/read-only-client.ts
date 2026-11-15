/**
 * The read-only Supabase client for the view-as tree (boundary b).
 *
 * View-As never changes the principal, so a write that reaches the database lands on the Admin's OWN rows. This wrapper makes
 * sure none is even attempted from view context: it is default-deny. Only
 *   - `rpc(name)` for a name on the READ allow-list (STABLE `admin_view_*` readers, the live-session check, the access read,
 *     and the audited private-media open),
 *   - `from(table).select(...)` chains (insert / update / upsert / delete throw),
 *   - `auth.getUser()` / `auth.getClaims()`
 * work. Storage, functions, realtime, schema switching, sign-out and every other auth call throw.
 */
export class ViewAsReadOnlyError extends Error {
  constructor(what: string) {
    super(`view_as_read_only: ${what}`);
    this.name = "ViewAsReadOnlyError";
  }
}

/** Extend this list deliberately, one reader per phase. Anything else is refused. */
export const VIEW_AS_READ_RPCS: ReadonlySet<string> = new Set([
  "admin_my_access",
  "admin_view_as_current",
  "admin_view_as_media_open",
  "admin_view_craftsman_dashboard",
  "admin_view_craftsman_profile",
  "admin_view_craftsman_portfolio",
  "admin_view_craftsman_work",
  "admin_view_craftsman_points",
  "admin_view_craftsman_reviews",
]);

const WRITE_VERBS = new Set(["insert", "update", "delete", "upsert"]);
const AUTH_READS = new Set(["getUser", "getClaims"]);
const THENABLE = new Set(["then", "catch", "finally"]);

function guardBuilder<T extends object>(builder: T): T {
  return new Proxy(builder, {
    get(target, prop) {
      if (typeof prop === "string" && WRITE_VERBS.has(prop)) {
        return () => {
          throw new ViewAsReadOnlyError(prop);
        };
      }
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const out = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (typeof prop === "string" && THENABLE.has(prop)) return out;
        return out && typeof out === "object" ? guardBuilder(out as object) : out;
      };
    },
  });
}

export function readOnlySupabase<T extends object>(client: T): T {
  const c = client as unknown as {
    rpc: (...a: unknown[]) => unknown;
    from: (...a: unknown[]) => object;
    auth: Record<string, unknown>;
  };
  const auth = new Proxy(c.auth ?? {}, {
    get(target, prop) {
      if (typeof prop === "string" && AUTH_READS.has(prop)) {
        const fn = Reflect.get(target, prop, target) as (...a: unknown[]) => unknown;
        return (...a: unknown[]) => fn.apply(target, a);
      }
      throw new ViewAsReadOnlyError(`auth.${String(prop)}`);
    },
  });
  return new Proxy(client, {
    get(target, prop) {
      // Never thenable: an `async` factory resolving this proxy must not trip the deny-by-default below.
      if (prop === "then") return undefined;
      if (typeof prop === "symbol") return Reflect.get(target, prop, target); // inspection, never a data surface
      if (prop === "rpc") {
        return (name: string, ...rest: unknown[]) => {
          if (!VIEW_AS_READ_RPCS.has(name)) throw new ViewAsReadOnlyError(`rpc ${name}`);
          return c.rpc.call(target, name, ...rest);
        };
      }
      if (prop === "from") return (...a: unknown[]) => guardBuilder(c.from.apply(target, a));
      if (prop === "auth") return auth;
      throw new ViewAsReadOnlyError(String(prop));
    },
  });
}

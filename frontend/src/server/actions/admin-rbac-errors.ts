/**
 * Maps an Admin RBAC RPC error to a stable translation KEY. Matches SQLSTATE and
 * short stable fragments of the RPCs' own messages (20260929100001) — never
 * locale text, never a raw database string in the UI. Specific rules come
 * before the generic 42501 fallback.
 */
type PgLikeError = { code?: string; message?: string };

export function mapRbacError(error: unknown): string {
  const e = (error ?? {}) as PgLikeError;
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();

  if (msg.includes("last active super admin")) return "admin.rbac.error.lastSuperAdmin";
  if (msg.includes("your own admin roles")) return "admin.rbac.error.self";
  if (msg.includes("not an existing admin staff")) return "admin.rbac.error.notStaff";
  if (msg.includes("a reason is required")) return "admin.rbac.error.reasonRequired";
  if (msg.includes("role name is required")) return "admin.rbac.error.nameRequired";
  if (msg.includes("already exists") || msg.includes("already assigned") || code === "23505")
    return "admin.rbac.error.duplicate";
  if (
    msg.includes("locked") ||
    msg.includes("core permission") ||
    msg.includes("immutable") ||
    msg.includes("system roles cannot")
  )
    return "admin.rbac.error.locked";
  if (
    msg.includes("below your own rank") ||
    msg.includes("your own authority") ||
    msg.includes("above your authority") ||
    msg.includes("you do not hold")
  )
    return "admin.rbac.error.ceiling";
  if (msg.includes("not assignable") || msg.includes("scope must match")) return "admin.rbac.error.notAssignable";
  if (msg.includes("already disabled") || msg.includes("nothing to restore")) return "admin.rbac.error.noChange";
  if (msg.includes("unknown permission")) return "states.genericRetry";
  if (code === "42501") return "admin.rbac.error.denied";
  return "states.genericRetry";
}

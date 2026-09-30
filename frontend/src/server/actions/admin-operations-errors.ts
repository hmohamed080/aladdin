/**
 * Maps an Admin Core 1B-B operational RPC error to a stable translation KEY.
 * Matches SQLSTATE and short, stable fragments of the RPCs' own messages
 * (20260930100002..04) — never locale text, never a raw database string in the
 * UI. Specific rules come before the generic 42501 fallback.
 */
type PgLikeError = { code?: string; message?: string };

export function mapOperationsError(error: unknown): string {
  const e = (error ?? {}) as PgLikeError;
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();

  if (msg.includes("last active super admin")) return "admin.preview.ops.error.lastSuperAdmin";
  if (msg.includes("your own account")) return "admin.preview.ops.error.self";
  if (msg.includes("at or above your own rank")) return "admin.preview.ops.error.rank";
  if (msg.includes("a reason is required")) return "admin.preview.ops.error.reasonRequired";
  if (msg.includes("deactivated account") || msg.includes("archived organization")) return "admin.preview.ops.error.notSuspendable";
  if (msg.includes("assignee")) return "admin.preview.ops.error.assignee";
  if (msg.includes("contact email")) return "admin.preview.ops.error.email";
  if (msg.includes("already been resolved differently") || msg.includes("already linked")) return "admin.preview.ops.error.alreadyResolved";
  if (msg.includes("itself linked") || msg.includes("existing record for other")) return "admin.preview.ops.error.chain";
  if (msg.includes("not found")) return "admin.preview.ops.error.notFound";
  if (code === "22023") return "admin.preview.ops.error.invalid";
  if (code === "42501") return "admin.preview.ops.error.denied";
  return "states.genericRetry";
}

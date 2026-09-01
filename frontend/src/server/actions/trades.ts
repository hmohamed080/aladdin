"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Saving your own trade selection (§4.3).
 *
 * THIS FILE DECIDES NOTHING. It forwards a complete selection to
 * `user_trades_set` and reports what the database said. Every rule lives there:
 *
 *   * WHOSE — the RPC takes no user id. It writes for `auth.uid()` and there is
 *     no parameter through which a caller could name someone else.
 *   * WHO MAY — `app.is_professional_persona`, canonical or declared. A
 *     consumer, a trainer, a business-only identity and an anonymous caller are
 *     refused with 42501.
 *   * WHAT IS VALID — unknown keys and newly-selected retired trades are 22023.
 *   * THE INVARIANT — exactly one primary whenever the selection is non-empty,
 *     maintained inside one transaction and backstopped by a partial unique
 *     index.
 *
 * IT POSTS THE WHOLE SET, NOT A DELTA, and that is what makes the client
 * unable to race itself. Two submissions in flight converge on whichever lands
 * last, because each is a complete description of the desired state rather than
 * an instruction to add or remove. An add/remove API would let a double-click
 * leave the person holding trades they had just deselected, or — worse — a
 * moment with no primary at all.
 */
export type TradesState = { ok: boolean; code?: string };

export async function setTradesAction(
  _prev: TradesState,
  fd: FormData,
): Promise<TradesState> {
  // The form posts one hidden field holding the entire selection, newline
  // separated, with the primary named separately. Two fields, one meaning: "this
  // is what I want to be true".
  const keys = String(fd.get("keys") ?? "")
    .split("\n")
    .map((k) => k.trim())
    .filter(Boolean);
  const primaryRaw = String(fd.get("primary") ?? "").trim();
  // A primary outside the set is a contradiction the database refuses; dropping
  // it here would be re-interpreting the caller's intent rather than saving it,
  // so it is passed through and the refusal is shown.
  // `undefined` rather than `null`: the generated RPC type models an optional
  // argument, and the SQL default is `null` — so omitting it says "you choose
  // the primary" through the same door a null would have.
  const primary = primaryRaw || undefined;

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("user_trades_set", {
    p_trade_keys: keys,
    p_primary_key: primary,
  });

  if (error) {
    return {
      ok: false,
      code:
        error.code === "42501"
          ? "profile.trades.notProfessional"
          : error.code === "22023"
            ? "profile.trades.unavailable"
            : "profile.trades.saveFailed",
    };
  }

  // The hub lists them, the dashboard shows the primary one, and the public page
  // is the reason any of it exists.
  revalidatePath("/home/profile");
  revalidatePath("/home/profile/edit");
  revalidatePath("/home");
  return { ok: true };
}

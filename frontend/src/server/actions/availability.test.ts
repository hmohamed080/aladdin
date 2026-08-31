import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

type Err = { code: string } | null;
const state: { user: { id: string } | null; error: Err } = { user: { id: "u1" }, error: null };
const captured: { update: Record<string, unknown> | null; eq: [string, string] | null } = {
  update: null,
  eq: null,
};

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      update(values: Record<string, unknown>) {
        captured.update = values;
        return {
          eq(col: string, val: string) {
            captured.eq = [col, val];
            return Promise.resolve({ error: state.error });
          },
        };
      },
    }),
  }),
}));

import { setAvailabilityAction } from "./availability";

const fd = (available: string) => {
  const f = new FormData();
  f.set("available", available);
  return f;
};

beforeEach(() => {
  state.user = { id: "u1" };
  state.error = null;
  captured.update = null;
  captured.eq = null;
  revalidatePath.mockClear();
});

/**
 * The availability write path.
 *
 * Almost nothing is decided here — ownership and the professional-identity gate
 * both live in the database (pgTAP 40). What IS this file's own contract, and so
 * what is asserted here: that it writes a VALUE rather than a flip, that it never
 * writes the timestamp, that it scopes the update to the authenticated caller,
 * and that it distinguishes the one refusal worth explaining from a generic
 * failure.
 */
describe("setAvailabilityAction", () => {
  it("writes the value the form asked for, not the opposite of the current one", async () => {
    // Posting a VALUE is what makes a double-click converge instead of flipping
    // twice. A toggle-shaped action would leave the second click asserting the
    // opposite of what the person clicked.
    await setAvailabilityAction({ ok: false }, fd("1"));
    expect(captured.update).toEqual({ available_for_work: true });

    await setAvailabilityAction({ ok: false }, fd("0"));
    expect(captured.update).toEqual({ available_for_work: false });
  });

  it("NEVER writes availability_updated_at", async () => {
    // The stamp is derived by the database trigger. A freshness signal the client
    // can supply is worth less than none, because the only reason the timestamp
    // is kept (O3) is so a reader can weigh the claim's age.
    await setAvailabilityAction({ ok: false }, fd("1"));
    expect(Object.keys(captured.update ?? {})).toEqual(["available_for_work"]);
  });

  it("scopes the write to the authenticated caller", async () => {
    // The action takes no user id from the form — there is no parameter through
    // which another person's row could be named. RLS is the real guarantee; this
    // pins that the code does not even offer the shape of a bypass.
    await setAvailabilityAction({ ok: false }, fd("1"));
    expect(captured.eq).toEqual(["user_id", "u1"]);
  });

  it("explains a 42501 rather than showing a generic retry", async () => {
    // The trigger refusing a non-professional identity is the one failure with a
    // meaning the person can act on.
    state.error = { code: "42501" };
    expect(await setAvailabilityAction({ ok: false }, fd("1"))).toEqual({
      ok: false,
      code: "profile.availability.notProfessional",
    });
  });

  it("treats any other database error as a retry", async () => {
    state.error = { code: "08006" };
    expect(await setAvailabilityAction({ ok: false }, fd("1"))).toEqual({
      ok: false,
      code: "states.genericRetry",
    });
  });

  it("refuses a signed-out caller without attempting a write", async () => {
    state.user = null;
    expect(await setAvailabilityAction({ ok: false }, fd("1"))).toEqual({
      ok: false,
      code: "states.genericRetry",
    });
    expect(captured.update).toBeNull();
  });

  it("revalidates both surfaces that show the state, and only on success", async () => {
    await setAvailabilityAction({ ok: false }, fd("1"));
    expect(revalidatePath.mock.calls.flat()).toEqual(["/home/profile", "/home"]);

    revalidatePath.mockClear();
    state.error = { code: "42501" };
    await setAvailabilityAction({ ok: false }, fd("1"));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

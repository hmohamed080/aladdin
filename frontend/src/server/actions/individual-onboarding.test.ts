import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ rpc })),
}));

import { saveProfessional } from "./individual-onboarding";

/**
 * The server action behind both the onboarding wizard and the profile editor.
 *
 * It is deliberately THIN — a shape validator over a trusted security-definer
 * RPC — and this pins that it stays thin. The authority question ("is this a
 * professional identity?") belongs to `individual_save_professional`, which
 * answers it from `auth.uid()` (pgTAP 39). An authority check duplicated here
 * would be a second rule to keep in step, and the increment that shipped one —
 * the editor's track-derived `canSave` — locked out every seeded professional in
 * the Pilot until it was removed.
 */
const valid = {
  concreteType: "installer_technician",
  headline: "Finishing specialist",
  yearsExperience: 12,
  specialization: "gypsum_paint",
  services: ["finishing"],
  languages: ["arabic"],
  availability: "flexible" as const,
  serviceAreas: ["nasr_city"],
  offersRemote: false,
  governorate: "cairo",
  city: "nasr_city",
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

describe("saveProfessional", () => {
  it("calls the trusted RPC and reports success", async () => {
    expect(await saveProfessional(valid)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe("individual_save_professional");
  });

  it("sends NO user id — ownership is auth.uid()'s to decide", async () => {
    await saveProfessional(valid);
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    for (const key of ["p_user_id", "p_uid", "user_id", "id"]) {
      expect(args[key]).toBeUndefined();
    }
    expect(args.p_concrete_type).toBe("installer_technician");
  });

  it("imposes NO authority check of its own — the database owns that question", async () => {
    // A caller the database will refuse still reaches it, and the refusal is
    // reported rather than pre-empted. A frontend gate stricter than the write
    // path is how a legitimate professional gets locked out of their own profile.
    rpc.mockResolvedValueOnce({ error: { code: "42501", message: "a professional account is required" } });
    expect(await saveProfessional(valid)).toEqual({ ok: false, code: "onboarding.error.saveFailed" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed shape before reaching the database", async () => {
    const result = await saveProfessional({ ...valid, concreteType: "not_a_persona" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes optional fields through as undefined rather than null", async () => {
    // `undefined` lets the RPC's own DEFAULT apply; an explicit null would write
    // one, which is the difference between "not edited" and "cleared".
    await saveProfessional({ concreteType: "installer_technician" });
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_headline).toBeUndefined();
    expect(args.p_specialization).toBeUndefined();
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const redirect = vi.fn((url: string) => {
  // Next's redirect() throws to unwind. Mimicking that is what lets a test tell
  // "the action redirected" apart from "the action returned a state".
  throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
});
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ rpc })),
}));

import {
  createJobAction,
  updateJobAction,
  publishJobAction,
  closeJobAction,
  cancelJobAction,
  acceptApplicationAction,
  rejectApplicationAction,
} from "./job-forms";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

const validJob = {
  orgId: "o1",
  title: "Marble staircase",
  tradeKey: "marble_granite",
  offeredAmount: "8500",
  // The place is CHOSEN from the catalogue (governorate, then a city inside it) — never typed.
  governorateKey: "cairo",
  cityKey: "maadi",
};

/** Run an action that is expected to redirect, and return the target. */
async function expectRedirect(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    const d = (e as { digest?: string }).digest ?? "";
    if (d.startsWith("NEXT_REDIRECT;")) return d.slice("NEXT_REDIRECT;".length);
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: "new-id", error: null });
  redirect.mockClear();
});

/**
 * These tests are about what the action layer FORWARDS and how it NAMES a
 * refusal. Not one of them asserts an authorization outcome, because the action
 * layer decides none — every rule lives in the Increment 6 RPCs.
 */
describe("createJobAction", () => {
  it("creates a DRAFT through job_create and goes to the new job", async () => {
    const to = await expectRedirect(() => createJobAction({ ok: false }, fd(validJob)));
    expect(rpc).toHaveBeenCalledWith("job_create", expect.objectContaining({
      p_org_id: "o1",
      p_title: "Marble staircase",
      p_trade_key: "marble_granite",
      p_offered_amount: 8500,
    }));
    expect(to).toBe("/b2b/jobs/new-id?created=1");
  });

  /**
   * There is no publish-on-create path. Publishing is what makes an opening
   * visible and freezes the offer on first application, and folding it into a
   * form submission would make both a side effect of pressing Save.
   */
  it("never publishes as part of creating", async () => {
    await expectRedirect(() => createJobAction({ ok: false }, fd(validJob)));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe("job_create");
  });

  it("sends no currency — EGP is the database's answer, not a parameter", async () => {
    await expectRedirect(() => createJobAction({ ok: false }, fd(validJob)));
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(args)).not.toContain("p_offered_currency");
  });

  it("names each missing field rather than failing generically", async () => {
    const r = await createJobAction({ ok: false }, fd({ orgId: "o1" }));
    expect(r.fieldErrors).toEqual({
      title: "jobs.validation.titleRequired",
      tradeKey: "jobs.validation.tradeRequired",
      offeredAmount: "jobs.validation.offerRequired",
      governorate: "jobs.validation.governorateRequired",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  describe("the place is a catalogue choice, never free text", () => {
    it("forwards the chosen KEYS and the catalogue's own English names — and no typed place", async () => {
      await expectRedirect(() => createJobAction({ ok: false }, fd(validJob)));
      expect(rpc).toHaveBeenCalledWith("job_create", expect.objectContaining({
        p_governorate_key: "cairo",
        p_city_key: "maadi",
        p_governorate: "Cairo",
        p_city: "Maadi",
      }));
    });

    it("a governorate without a city is refused next to the city field", async () => {
      const r = await createJobAction({ ok: false }, fd({ ...validJob, cityKey: "" }));
      expect(r.fieldErrors).toEqual({ city: "jobs.validation.cityRequired" });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("a new job with no place at all is refused", async () => {
      const r = await createJobAction({ ok: false }, fd({ ...validJob, governorateKey: "", cityKey: "" }));
      expect(r.fieldErrors).toEqual({ governorate: "jobs.validation.governorateRequired" });
    });

    it("an unknown governorate key is still forwarded as a key — the DATABASE judges it, and its refusal is named", async () => {
      rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "unknown governorate" } });
      const r = await createJobAction({ ok: false }, fd({ ...validJob, governorateKey: "atlantis", cityKey: "x" }));
      expect(r.code).toBe("jobs.errors.location");
    });

    it("the optional required specialty is forwarded as an id", async () => {
      await expectRedirect(() => createJobAction({ ok: false }, fd({ ...validJob, requiredSpecialtyId: "5b0c2f9e-1111-4222-8333-444455556666" })));
      expect(rpc).toHaveBeenCalledWith("job_create", expect.objectContaining({ p_required_specialty_id: "5b0c2f9e-1111-4222-8333-444455556666" }));
    });

    it("no specialty chosen sends none", async () => {
      await expectRedirect(() => createJobAction({ ok: false }, fd(validJob)));
      expect((rpc.mock.calls[0]![1] as Record<string, unknown>).p_required_specialty_id).toBeUndefined();
    });
  });

  it("refuses a non-positive amount before a round trip", async () => {
    const r = await createJobAction({ ok: false }, fd({ ...validJob, offeredAmount: "0" }));
    expect(r.fieldErrors?.offeredAmount).toBe("jobs.validation.offerPositive");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("catches an impossible date range next to the field", async () => {
    const r = await createJobAction(
      { ok: false },
      fd({ ...validJob, startsOn: "2026-10-10", endsBy: "2026-10-01" }),
    );
    expect(r.fieldErrors?.endsBy).toBe("jobs.validation.dateOrder");
  });
});

describe("updateJobAction — the place", () => {
  it("a legacy job whose old text never resolved can be edited WITHOUT choosing a place — none is sent, so the database keeps it", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    const { governorateKey: _g, cityKey: _c, ...noPlace } = validJob;
    void _g; void _c;
    await expectRedirect(() => updateJobAction({ ok: false }, fd({ ...noPlace, jobId: "j1", expectedVersion: "2", keepLegacyLocation: "1" })));
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    for (const key of ["p_governorate_key", "p_city_key", "p_governorate", "p_city"]) expect(args[key], key).toBeUndefined();
  });

  it("without that flag a missing place is a field error — a normal edit cannot silently drop the place", async () => {
    const { governorateKey: _g, cityKey: _c, ...noPlace } = validJob;
    void _g; void _c;
    const r = await updateJobAction({ ok: false }, fd({ ...noPlace, jobId: "j1", expectedVersion: "2" }));
    expect(r.fieldErrors?.governorate).toBe("jobs.validation.governorateRequired");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("chosen keys are sent on update too", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    await expectRedirect(() => updateJobAction({ ok: false }, fd({ ...validJob, governorateKey: "giza", cityKey: "dokki", jobId: "j1", expectedVersion: "2" })));
    expect(rpc).toHaveBeenCalledWith("job_update", expect.objectContaining({ p_governorate_key: "giza", p_city_key: "dokki", p_governorate: "Giza", p_city: "Dokki" }));
  });
});

describe("updateJobAction", () => {
  it("forwards the expected version so a concurrent edit is caught", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    await expectRedirect(() =>
      updateJobAction({ ok: false }, fd({ ...validJob, jobId: "j1", expectedVersion: "2" })),
    );
    expect(rpc).toHaveBeenCalledWith("job_update", expect.objectContaining({
      p_job_id: "j1",
      p_expected_version: 2,
    }));
  });

  it("reports a concurrent modification as its own message", async () => {
    rpc.mockResolvedValue({ error: { code: "40001", message: "job was modified concurrently" } });
    const r = await updateJobAction(
      { ok: false },
      fd({ ...validJob, jobId: "j1", expectedVersion: "2" }),
    );
    expect(r).toEqual({ ok: false, code: "jobs.errors.conflict" });
  });

  /** O7: the poster is told what to do instead, not merely refused. */
  it("explains the frozen offer rather than saying permission denied", async () => {
    rpc.mockResolvedValue({
      error: { message: "the offer and trade cannot change once someone has applied" },
    });
    const r = await updateJobAction(
      { ok: false },
      fd({ ...validJob, jobId: "j1", expectedVersion: "2" }),
    );
    expect(r.code).toBe("jobs.errors.offerLocked");
  });
});

describe("publishJobAction", () => {
  it("publishes through job_publish and never by writing a status", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    const r = await publishJobAction({ ok: false }, fd({ jobId: "j1", expectedVersion: "1" }));
    expect(rpc).toHaveBeenCalledWith("job_publish", { p_job_id: "j1", p_expected_version: 1 });
    expect(r).toEqual({ ok: true, code: "jobs.flash.published" });
  });

  /**
   * `job_publish` raises the verification refusal with 42501. Falling through to
   * the generic permission message would tell an owner they lack an authority
   * they actually hold — and hide the one thing that would fix it.
   */
  it("names the verification requirement, not a permission failure", async () => {
    rpc.mockResolvedValue({
      error: { code: "42501", message: "the organization must be verified to publish a job" },
    });
    const r = await publishJobAction({ ok: false }, fd({ jobId: "j1", expectedVersion: "1" }));
    expect(r.code).toBe("jobs.errors.unverified");
  });

  it("still reports a real permission failure as one", async () => {
    rpc.mockResolvedValue({ error: { code: "42501", message: "job.post required" } });
    const r = await publishJobAction({ ok: false }, fd({ jobId: "j1", expectedVersion: "1" }));
    expect(r.code).toBe("jobs.errors.denied");
  });
});

describe("close and cancel", () => {
  it("closes through job_close", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    const r = await closeJobAction({ ok: false }, fd({ jobId: "j1", expectedVersion: "1" }));
    expect(rpc).toHaveBeenCalledWith("job_close", { p_job_id: "j1", p_expected_version: 1 });
    expect(r.code).toBe("jobs.flash.closed");
  });

  it("cancels through job_cancel, carrying the reason", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    await cancelJobAction({ ok: false }, fd({ jobId: "j1", expectedVersion: "1", reason: "Site delayed" }));
    expect(rpc).toHaveBeenCalledWith("job_cancel", {
      p_job_id: "j1",
      p_expected_version: 1,
      p_reason: "Site delayed",
    });
  });

  /**
   * The two-step invariant. An awarded job cannot be cancelled on its own, and
   * the poster is told what has to happen first rather than being told no.
   */
  it("explains the assignment-first rule when an awarded job is cancelled", async () => {
    rpc.mockResolvedValue({
      error: { message: "cancel its assignment first" },
    });
    const r = await cancelJobAction({ ok: false }, fd({ jobId: "j1", expectedVersion: "1" }));
    expect(r.code).toBe("jobs.errors.awardedCancel");
  });
});

describe("acceptApplicationAction", () => {
  /**
   * THE critical assertion of this file. Accepting is ONE call. The sibling
   * rejections, the assignment insert and the job's move to `awarded` all happen
   * inside `job_application_accept`, in one transaction — and a UI that also
   * rejected the others would be running part of that transaction outside it.
   */
  it("awards with exactly one RPC and imitates none of the transaction", async () => {
    await expectRedirect(() =>
      acceptApplicationAction({ ok: false }, fd({ applicationId: "a1", jobId: "j1" })),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("job_application_accept", { p_application_id: "a1" });
    const called = rpc.mock.calls.map((c) => c[0]);
    expect(called).not.toContain("job_application_reject");
    expect(called).not.toContain("job_update");
  });

  it("returns to the job so the awarded state is what the poster sees next", async () => {
    const to = await expectRedirect(() =>
      acceptApplicationAction({ ok: false }, fd({ applicationId: "a1", jobId: "j1" })),
    );
    expect(to).toBe("/b2b/jobs/j1?awarded=1");
  });

  it("reports an already-decided candidacy for what it is", async () => {
    rpc.mockResolvedValue({ error: { message: "a rejected application cannot be accepted" } });
    const r = await acceptApplicationAction({ ok: false }, fd({ applicationId: "a1", jobId: "j1" }));
    expect(r.code).toBe("jobs.errors.alreadyDecided");
  });
});

describe("rejectApplicationAction", () => {
  it("requires the reason before spending a round trip", async () => {
    const r = await rejectApplicationAction({ ok: false }, fd({ applicationId: "a1", jobId: "j1" }));
    expect(r.fieldErrors?.reason).toBe("jobs.validation.reasonRequired");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards the reason the applicant will read", async () => {
    rpc.mockResolvedValue({ error: null });
    const r = await rejectApplicationAction(
      { ok: false },
      fd({ applicationId: "a1", jobId: "j1", reason: "Booked elsewhere." }),
    );
    expect(rpc).toHaveBeenCalledWith("job_application_reject", {
      p_application_id: "a1",
      p_reason: "Booked elsewhere.",
    });
    expect(r).toEqual({ ok: true, code: "jobs.flash.rejected" });
  });

  /** Declining one applicant must not touch the job or anyone else. */
  it("declines with one RPC and nothing else", async () => {
    rpc.mockResolvedValue({ error: null });
    await rejectApplicationAction(
      { ok: false },
      fd({ applicationId: "a1", jobId: "j1", reason: "x" }),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("work contact (an OPTIONAL section, provided for this job — never read from a profile)", () => {
  const contact = { contactName: "Site coordinator", contactPhone: "+201001112222", contactEmail: "work@horizon.example.test" };

  it("a job without any contact is created exactly as before — one RPC, no contact call", async () => {
    await expectRedirect(() => createJobAction({ ok: false }, fd(validJob)));
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["job_create"]);
  });

  it("an empty contact section sends nothing either", async () => {
    await expectRedirect(() => createJobAction({ ok: false }, fd({ ...validJob, contactName: "", contactPhone: "", contactEmail: "" })));
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["job_create"]);
  });

  it("a provided contact is saved through job_work_contact_set against the NEW job id", async () => {
    const to = await expectRedirect(() => createJobAction({ ok: false }, fd({ ...validJob, ...contact })));
    expect(rpc).toHaveBeenNthCalledWith(2, "job_work_contact_set", {
      p_job_id: "new-id",
      p_contact_name: "Site coordinator",
      p_phone_e164: "+201001112222",
      p_email: "work@horizon.example.test",
    });
    expect(to).toBe("/b2b/jobs/new-id?created=1");
  });

  it("phone only, or e-mail only, is enough", async () => {
    await expectRedirect(() => createJobAction({ ok: false }, fd({ ...validJob, contactPhone: "+201001112222" })));
    expect(rpc).toHaveBeenLastCalledWith("job_work_contact_set", expect.objectContaining({ p_phone_e164: "+201001112222", p_email: "" }));
    rpc.mockClear();
    await expectRedirect(() => createJobAction({ ok: false }, fd({ ...validJob, contactEmail: "a@b.co" })));
    expect(rpc).toHaveBeenLastCalledWith("job_work_contact_set", expect.objectContaining({ p_phone_e164: "", p_email: "a@b.co" }));
  });

  it("a phone typed but not valid is refused next to its field — it is never silently dropped", async () => {
    const r = await createJobAction({ ok: false }, fd({ ...validJob, contactPhone: "", contactPhoneInvalid: "1" }));
    expect(r.fieldErrors?.contactPhone).toBe("jobs.validation.contactPhoneInvalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a phone that is not E.164 is refused before a round trip", async () => {
    const r = await createJobAction({ ok: false }, fd({ ...validJob, contactPhone: "01001112222" }));
    expect(r.fieldErrors?.contactPhone).toBe("jobs.validation.contactPhoneInvalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an invalid e-mail is refused", async () => {
    const r = await createJobAction({ ok: false }, fd({ ...validJob, contactEmail: "not-an-email" }));
    expect(r.fieldErrors?.contactEmail).toBe("jobs.validation.contactEmailInvalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a name with nothing to reach them by is refused", async () => {
    const r = await createJobAction({ ok: false }, fd({ ...validJob, contactName: "Only a name" }));
    expect(r.fieldErrors?.contactPhone).toBe("jobs.validation.contactReach");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("if the contact cannot be saved after the draft exists, the poster lands on its edit page — no duplicate job", async () => {
    rpc.mockImplementation(async (name: string) => (name === "job_work_contact_set" ? { data: null, error: { code: "23514", message: "x" } } : { data: "new-id", error: null }));
    const to = await expectRedirect(() => createJobAction({ ok: false }, fd({ ...validJob, ...contact })));
    expect(to).toBe("/b2b/jobs/new-id/edit?contact=failed");
    expect(rpc.mock.calls.filter((c) => c[0] === "job_create")).toHaveLength(1);
  });

  it("editing saves the contact after the job update, with the job id from the FORM's own record", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    await expectRedirect(() => updateJobAction({ ok: false }, fd({ ...validJob, jobId: "j1", expectedVersion: "2", ...contact })));
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["job_update", "job_work_contact_set"]);
    expect(rpc).toHaveBeenLastCalledWith("job_work_contact_set", expect.objectContaining({ p_job_id: "j1", p_phone_e164: "+201001112222" }));
  });

  it("editing with the contact section emptied CLEARS the contact", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    await expectRedirect(() =>
      updateJobAction({ ok: false }, fd({ ...validJob, jobId: "j1", expectedVersion: "2", contactName: "", contactPhone: "", contactEmail: "" })),
    );
    expect(rpc).toHaveBeenLastCalledWith("job_work_contact_set", { p_job_id: "j1", p_contact_name: "", p_phone_e164: "", p_email: "" });
  });

  it("an update from a form without the section leaves the contact alone", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    await expectRedirect(() => updateJobAction({ ok: false }, fd({ ...validJob, jobId: "j1", expectedVersion: "2" })));
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["job_update"]);
  });

  it("the accept action carries no contact payload — the snapshot happens inside the database", async () => {
    rpc.mockResolvedValue({ data: "asg-1", error: null });
    await expectRedirect(() => acceptApplicationAction({ ok: false }, fd({ applicationId: "app-1", jobId: "j1", contactPhone: "+201009999999", contactName: "Forged" })));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("job_application_accept", { p_application_id: "app-1" });
  });
});

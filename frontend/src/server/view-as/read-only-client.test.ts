import { describe, expect, it, vi } from "vitest";
import { readOnlySupabase, ViewAsReadOnlyError, VIEW_AS_READ_RPCS } from "./read-only-client";

type Builder = Record<string, (...a: unknown[]) => unknown> & PromiseLike<unknown>;
type Loose = {
  rpc(name: string, args?: unknown): Promise<unknown>;
  from(table: string): Builder;
  storage: unknown;
  functions: unknown;
  auth: Record<string, (...a: unknown[]) => Promise<unknown>>;
};

function fake() {
  const calls: string[] = [];
  const builder = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      insert: () => { calls.push("insert"); return b; },
      update: () => { calls.push("update"); return b; },
      delete: () => { calls.push("delete"); return b; },
      upsert: () => { calls.push("upsert"); return b; },
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    };
    return b;
  };
  const client = {
    rpc: vi.fn(async (name: string) => ({ data: name, error: null })),
    from: vi.fn(() => builder()),
    storage: { from: () => ({ upload: () => calls.push("upload") }) },
    functions: { invoke: () => calls.push("invoke") },
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "a" } } })), getClaims: vi.fn(), signOut: vi.fn() },
  };
  return { client, calls, ro: readOnlySupabase(client) as unknown as Loose };
}

describe("readOnlySupabase (default-deny)", () => {
  it("lets an allow-listed reader RPC through with its arguments", async () => {
    const { client, ro } = fake();
    await expect(ro.rpc("admin_view_craftsman_profile", { p_subject: "x" })).resolves.toEqual({ data: "admin_view_craftsman_profile", error: null });
    expect(client.rpc).toHaveBeenCalledWith("admin_view_craftsman_profile", { p_subject: "x" });
  });

  it("refuses every RPC that is not on the READ allow-list, including the session writers and 'my_*' actions", () => {
    const { client, ro } = fake();
    for (const name of ["admin_view_as_begin", "admin_view_as_end", "admin_view_as_end_all", "my_account_status", "admin_update_user", "anything"]) {
      expect(() => ro.rpc(name), name).toThrow(ViewAsReadOnlyError);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("allow-list contains only reader / session-check / audited-media names (no begin/end)", () => {
    for (const n of VIEW_AS_READ_RPCS) expect(n).toMatch(/^admin_(my_access|view_as_current|view_as_media_open|view_craftsman_[a-z]+)$/);
  });

  it("refuses insert / update / delete / upsert before they reach the builder, but allows select chains", async () => {
    const { calls, ro } = fake();
    for (const verb of ["insert", "update", "delete", "upsert"]) {
      expect(() => ro.from("t")[verb]!(), verb).toThrow(ViewAsReadOnlyError);
      expect(() => (ro.from("t").select!("*") as Builder).eq!("a", 1) && (ro.from("t").select!("*") as Builder)[verb]!(), verb).toThrow(ViewAsReadOnlyError);
    }
    expect(calls).toEqual([]);
    await expect(Promise.resolve(ro.from("t").select!("*") as Builder)).resolves.toEqual({ data: [], error: null });
  });

  it("refuses storage, functions, sign-out and any unknown surface; only auth.getUser / getClaims work", async () => {
    const { client, ro } = fake();
    expect(() => ro.storage).toThrow(ViewAsReadOnlyError);
    expect(() => ro.functions).toThrow(ViewAsReadOnlyError);
    expect(() => ro.auth.signOut).toThrow(ViewAsReadOnlyError);
    await expect(ro.auth.getUser!()).resolves.toBeTruthy();
    expect(client.auth.getUser).toHaveBeenCalled();
  });

  it("can be returned from an async function (never thenable)", async () => {
    const { ro } = fake();
    const make = async () => ro;
    await expect(make()).resolves.toBe(ro);
  });
});

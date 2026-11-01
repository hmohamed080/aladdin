import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script, no types
import { checkScope } from "../../../scripts/check-r2-credential-scope.mjs";

const fake = (allow: Set<string>, behaviour: Record<string, "ok" | "deny"> = {}) => ({
  async send(command: { input: { Bucket: string } }) {
    const bucket = command.input.Bucket;
    if (!allow.has(bucket) && behaviour[bucket] !== "ok") throw Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    return {};
  },
});

describe("R2 credential scope probe", () => {
  it("passes for a credential limited to its own bucket", async () => {
    expect(await checkScope(fake(new Set(["mine"])), { allowed: "mine", forbidden: ["other", "backup"] })).toEqual([]);
  });
  it("fails a credential that can also reach another environment's bucket", async () => {
    const problems = await checkScope(fake(new Set(["mine", "other"])), { allowed: "mine", forbidden: ["other"] });
    expect(problems.join()).toContain("forbidden bucket");
  });
  it("fails a credential that cannot use its own bucket", async () => {
    expect(await checkScope(fake(new Set()), { allowed: "mine", forbidden: [] })).toHaveLength(1);
  });
  it("does not accept a non-permission error as proof of isolation", async () => {
    const client = { async send() { throw Object.assign(new Error("boom"), { name: "InternalError", $metadata: { httpStatusCode: 500 } }); } };
    expect((await checkScope(client, { allowed: "mine", forbidden: ["other"] })).join()).toContain("expected AccessDenied");
  });
});

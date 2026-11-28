import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { handleRequest } from "../src/index.ts";
import { goodBody, mockMeta, signedSend } from "./support.ts";
import { configure, envFor, setAttestation, setDeliverySwitch, withD1 } from "./d1.ts";

// The Production permit (WHATSAPP_DELIVERY_ENABLED="true") is ONE of four send conditions. With the permit on and any other condition missing,
// the Production-shaped Worker must send nothing and never call Meta.
const prod = (d1: unknown) => envFor(d1, { OTP_ENVIRONMENT: "production", OTP_RECIPIENT_MODE: "open", OTP_ALLOWED_RECIPIENTS: "", WHATSAPP_DELIVERY_ENABLED: "true" });
const refused = async (d1: unknown, meta: ReturnType<typeof mockMeta>, id: string) => {
  const res = await handleRequest(await signedSend(goodBody({ delivery_id: id })), prod(d1), meta.fetcher);
  assert.equal(res.status, 503);
};

describe("Production permit true: nothing sends unless switch, limits and attestation all hold", () => {
  test("permit alone (settings configured, no switch row), an OFF switch, and an ON switch without a valid production attestation all refuse and never call Meta", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      const meta = mockMeta();
      await refused(d1, meta, "0c1d2e3f-0000-4000-8000-000000000001"); // permit true, no switch row
      await setDeliverySwitch(d1, false);
      await refused(d1, meta, "0c1d2e3f-0000-4000-8000-000000000002"); // switch OFF
      await setDeliverySwitch(d1, true, 2);
      await setAttestation(d1, true, 2, { env: "production", issuedAt: Math.floor(Date.now() / 1000) - 3600 });
      await refused(d1, meta, "0c1d2e3f-0000-4000-8000-000000000003"); // stale attestation
      await setAttestation(d1, true, 2, { env: "acceptance" });
      await refused(d1, meta, "0c1d2e3f-0000-4000-8000-000000000004"); // another environment's attestation
      await setAttestation(d1, false, 2, { env: "production" });
      await refused(d1, meta, "0c1d2e3f-0000-4000-8000-000000000005"); // attestation says OFF
      await d1.prepare("DELETE FROM otp_delivery_attestation").run();
      await refused(d1, meta, "0c1d2e3f-0000-4000-8000-000000000006"); // no attestation
      assert.equal(meta.calls.length, 0);
    });
  });

  test("switch ON with a valid production attestation but NO configured limits sends nothing", async () => {
    await withD1(async (d1) => {
      const meta = mockMeta();
      await setDeliverySwitch(d1, true);
      await setAttestation(d1, true, 1, { env: "production" });
      await refused(d1, meta, "0c1d2e3f-0000-4000-8000-000000000007");
      assert.equal(meta.calls.length, 0);
    });
  });

  test("control: permit + audited switch ON + limits + valid production attestation sends exactly once; turning the switch OFF stops it at once", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      const meta = mockMeta();
      await setDeliverySwitch(d1, true);
      await setAttestation(d1, true, 1, { env: "production" });
      const ok = await handleRequest(await signedSend(goodBody({ delivery_id: "0c1d2e3f-0000-4000-8000-000000000008" })), prod(d1), meta.fetcher);
      assert.equal(ok.status, 200);
      assert.equal(meta.calls.length, 1);
      await setDeliverySwitch(d1, false, 2);
      await setAttestation(d1, false, 2, { env: "production" });
      await refused(d1, meta, "0c1d2e3f-0000-4000-8000-000000000009");
      assert.equal(meta.calls.length, 1);
    });
  });
});

import { test } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { signIn, IDENTITIES } from "./helpers/auth";

/**
 * Captures a real signed-in manager session as a Lighthouse `--extra-headers`
 * file so the authenticated /b2b and /b2b/leads routes can be measured by
 * Lighthouse (which has no login flow). Gated by LH=1. Run against the SAME
 * production origin Lighthouse will hit (E2E_PORT).
 */
test("capture manager session cookie header for Lighthouse", async ({ page, request }) => {
  test.skip(process.env.LH !== "1", "set LH=1 to capture the Lighthouse session header");
  await signIn(page, request, IDENTITIES.manager);
  const cookies = await page.context().cookies();
  const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  mkdirSync("test-results/lh", { recursive: true });
  writeFileSync("test-results/lh/extra-headers.json", JSON.stringify({ Cookie: header }));
});

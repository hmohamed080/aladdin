import { test } from "@playwright/test";
import { signIn, IDENTITIES } from "../e2e/helpers/auth";

/**
 * Geometry and computed-style readout for the SHELL PLANES.
 *
 * The pixel scans in `.scanmine.mjs` answer "what colour is it"; this answers
 * "where is it and did the rule apply", which is the question that actually
 * goes wrong. Probing the dev server directly does not work — `/b2b` redirects
 * to sign-in without a session, and the resulting page has no `#main` at all,
 * which reads as "the class did not apply" rather than "you are not logged in".
 */
test("shell planes — geometry and computed styles", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: "en", url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: "light", url: "http://127.0.0.1" },
    { name: "aladdin-sidebar", value: "expanded", url: "http://127.0.0.1" },
  ]);
  await signIn(page, request, IDENTITIES.importer);
  await page.goto("/b2b", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);

  console.log(
    (
      await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const main = document.getElementById("main")!;
        const frame = main.closest<HTMLElement>(".workspace-frame")!;
        const header = document.querySelector<HTMLElement>("header")!;
        const L: string[] = [];
        L.push(`dir = ${document.documentElement.dir}`);
        for (const v of ["--frame-pool-x", "--frame-warm-x", "--wash-angle", "--workspace", "--frame"])
          L.push(`${v.padEnd(16)} = ${cs.getPropertyValue(v).trim()}`);
        const rect = (n: string, e: HTMLElement) => {
          const r = e.getBoundingClientRect();
          L.push(`${n.padEnd(8)} x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.width)} h=${Math.round(r.height)} r=${Math.round(r.right)} b=${Math.round(r.bottom)}`);
        };
        rect("frame", frame);
        rect("header", header);
        rect("main", main);
        const mcs = getComputedStyle(main);
        L.push(`main bg      = ${mcs.backgroundColor}`);
        L.push(`main radius  = ${mcs.borderTopLeftRadius}`);
        L.push(`main shadow  = ${mcs.boxShadow.slice(0, 80)}`);
        const bef = getComputedStyle(main, "::before");
        L.push(`::before rad = ${bef.borderTopLeftRadius}`);
        L.push(`::before img = ${bef.backgroundImage.slice(0, 120)}`);
        const fcs = getComputedStyle(frame);
        L.push(`frame bg     = ${fcs.backgroundColor}`);
        L.push(`frame layers = ${(fcs.backgroundImage.match(/gradient/g) ?? []).length}`);
        // The gutter: sidebar spacer's trailing edge to the body's leading edge.
        const side = document.querySelector<HTMLElement>('[data-testid="nav-carve"]')?.closest("aside, div");
        if (side) rect("sidebar", side as HTMLElement);
        return L;
      })
    ).join("\n"),
  );
});

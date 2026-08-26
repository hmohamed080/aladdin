import { test } from "@playwright/test";
import { signIn, IDENTITIES } from "../e2e/helpers/auth";

/**
 * Read the SHELL's rendered geometry, colour and CSS back out of the browser.
 *
 * Screenshots answer "does this look right"; they are bad at "is this the value
 * I think it is", because a JPEG of a large flat area at 40% of a token's
 * lightness is indistinguishable from the same area at 60%. Several corrections
 * in this pass turned on a handful of units in one channel, and guessing at
 * those from an image is how a wrong token survives three iterations.
 *
 * It also dumps the actual generated rule for the shell's background utilities,
 * which is the only way to tell a token that is wrong apart from a utility that
 * Tailwind never emitted — the two look identical on screen (nothing is
 * painted) and have completely different fixes.
 */
test("shell probe", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: "en", url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: "light", url: "http://127.0.0.1" },
    { name: "aladdin-sidebar", value: "expanded", url: "http://127.0.0.1" },
  ]);
  await signIn(page, request, IDENTITIES.importer);
  await page.goto("/b2b", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const out = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const vars = ["--frame", "--body", "--shell", "--shell-active", "--shell-gutter-w"];

    const rules: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList;
      try {
        list = sheet.cssRules;
      } catch {
        continue;
      }
      for (const r of Array.from(list)) {
        const t = r.cssText ?? "";
        if (/\.bg-(frame|body|shell)[,{ ]/.test(t) || /\.border-body-line/.test(t)) {
          rules.push(t.slice(0, 220));
        }
      }
    }

    const box = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return `${sel}: MISSING`;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return `${sel}: x=${Math.round(r.x)} w=${Math.round(r.width)} h=${Math.round(
        r.height,
      )} bg=${s.backgroundColor} radius=${s.borderRadius}`;
    };

    return [
      ...vars.map((v) => `${v} = ${cs.getPropertyValue(v).trim()}`),
      `--- ${rules.length} matching rules ---`,
      ...rules.map((r) => "RULE " + r),
      "--- boxes ---",
      box("[data-shell-sidebar]"),
      box("header"),
      box("main"),
      box('[data-testid="nav-carve"]'),
      (() => { const b=document.querySelector('[data-testid="global-search-trigger"]'); if(!b) return "search: MISSING"; const sp=b.querySelector("span"); if(!sp) return "search span: MISSING"; const cs=getComputedStyle(sp); return `search span: color=${cs.color} size=${cs.fontSize} cls=${b.className}`; })(),
    ].join("\n");
  });
  console.log("\n" + out + "\n");
});

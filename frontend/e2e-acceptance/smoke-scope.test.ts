import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Pins the `scope: smoke` selection in .github/workflows/hosted-acceptance-e2e.yml to the spec's public smoke describe.
// Playwright greps "<project> <file> <describe titles...> <test title>" joined by spaces.
const workflow = readFileSync(resolve(__dirname, "../../.github/workflows/hosted-acceptance-e2e.yml"), "utf8");
const spec = readFileSync(resolve(__dirname, "hosted-acceptance.spec.ts"), "utf8");

const grepSource = /SMOKE_GREP='([^']+)'/.exec(workflow)?.[1];

function titlePath(...parts: string[]): string {
  return ["", "chromium", "hosted-acceptance.spec.ts", ...parts].join(" ").trim();
}

describe("hosted acceptance smoke scope", () => {
  it("the workflow defines a SMOKE_GREP pattern", () => {
    expect(grepSource).toBeTruthy();
  });

  it("matches every test inside the public smoke describe", () => {
    const re = new RegExp(grepSource ?? "(?!)");
    const block = /test\.describe\("public smoke", \(\) => \{([\s\S]*?)\n\}\);/.exec(spec)?.[1];
    expect(block, "the spec must still contain describe('public smoke')").toBeTruthy();
    const titles = [...(block ?? "").matchAll(/^\s{2}test\("([^"]+)"/gm)].map((m) => m[1]);
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) expect(re.test(titlePath("public smoke", title)), title).toBe(true);
  });

  it("matches no persona or Showroom drift test", () => {
    const re = new RegExp(grepSource ?? "(?!)");
    const others = [
      titlePath("owner (test1@example.com)", "workspace and Sales screens render"),
      titlePath("Sales Manager (x@example.com)", "People refuses member management"),
      titlePath("Sales Rep (y@example.com)", "Sales branch scope matches the membership"),
      titlePath("Showroom RC2 drift observations (owner, record only)", "record what renders for each drifted assertion"),
      titlePath("owner (a@b.c)", "public smoke look-alike test"),
    ];
    for (const t of others) expect(re.test(t), t).toBe(false);
  });

  it("smoke scope never requires or exports persona passwords", () => {
    const requireStep = /- name: Require the secrets this scope needs[\s\S]*?(?=\n      - uses:)/.exec(workflow)?.[0] ?? "";
    const smokeNames = /names="(ACCEPTANCE_E2E_ACCESS[^"]+)"/.exec(requireStep)?.[1] ?? "";
    expect(smokeNames).not.toMatch(/PASSWORD/);
    expect(workflow).toMatch(/inputs\.scope == 'full'\) && secrets\.ACCEPTANCE_E2E_OWNER_PASSWORD/);
  });
});

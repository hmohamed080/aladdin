import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { ALWAYS_PASS_SITE_KEY, TURNSTILE_STUB, classifySiteKey, judgeStubbedWidget } from "./turnstile.mjs";

describe("classifySiteKey", () => {
  it.each([
    [ALWAYS_PASS_SITE_KEY, "always-pass-test"],
    ["2x00000000000000000000AB", "always-block-test"],
    ["3x00000000000000000000FF", "interactive-test"],
    ["0x4AAAAAAAexampleRealKey", "real"],
    ["", "missing"],
    [undefined, "missing"],
  ])("%s -> %s", (key, kind) => expect(classifySiteKey(key)).toBe(kind));
});

describe("judgeStubbedWidget fails closed", () => {
  it("accepts only the always-pass test key", () => expect(judgeStubbedWidget({ sitekey: ALWAYS_PASS_SITE_KEY })).toBeNull());
  it.each(["0x4AAAAAAAexampleRealKey", "2x00000000000000000000AB", "3x00000000000000000000FF", ""])("refuses %j", (k) => {
    const msg = judgeStubbedWidget({ sitekey: k });
    expect(msg).toMatch(/will not weaken CAPTCHA/);
    expect(msg).toMatch(/ACCEPTANCE_E2E_CAPTCHA\.md/);
    if (k) expect(msg).not.toContain(k);
  });
  it("refuses when no widget rendered", () => expect(judgeStubbedWidget({ sitekey: null })).toMatch(/never rendered/));
});

describe("TURNSTILE_STUB", () => {
  function run(sitekey: string) {
    const tokens: string[] = [];
    const window: Record<string, unknown> = {};
    const timers: Array<() => void> = [];
    runInNewContext(TURNSTILE_STUB, { window, setTimeout: (f: () => void) => timers.push(f) });
    (window.turnstile as { render: (el: unknown, o: unknown) => string }).render({}, { sitekey, callback: (t: string) => tokens.push(t) });
    timers.forEach((f) => f());
    return { tokens, state: window.__e2eTurnstile as { sitekey: string; answered: boolean } };
  }
  it("answers for the always-pass key and records it", () => {
    const r = run(ALWAYS_PASS_SITE_KEY);
    expect(r.tokens).toHaveLength(1);
    expect(r.state.sitekey).toBe(ALWAYS_PASS_SITE_KEY);
  });
  it("gives no token for a real key but records it for the fail-closed check", () => {
    const r = run("0x4AAAAAAAexampleRealKey");
    expect(r.tokens).toHaveLength(0);
    expect(r.state.answered).toBe(false);
    expect(judgeStubbedWidget(r.state)).not.toBeNull();
  });
});
